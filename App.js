const http = require("http");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

class Query {
  field; // "owner", "title", or "content"
  search; // string
}

satisfiesQuery = (query, todo) => {
  return todo[query.field].includes(query.search);
};

class User {
  name;
  idtoken;
  passwordHash;
  salt;
}

class Todo {
  owner;
  title;
  content;
  id;
}

class Server {
  #express;
  #todos;
  #counter;
  #users;

  constructor() {
    this.todos = [];
    this.counter = 0;

    this.users = [
      {
        name: "admin",
        idtoken: "faketoken",
        passwordHash: "unhashedpassword",
        salt: "nosalt",
      },
    ];

    this.express = express();
    this.express.use(express.json());
    this.express.use(express.raw({ type: "application/*", limit: "10mb" }));
    this.express.use(cors());

    this.express.get("/todo", this.getTodos);
    this.express.post("/todo", this.addTodo);
    this.express.get("/todo/:id", this.getTodo);
    this.express.put("/todo/:id", this.editTodo);
    this.express.delete("/todo/:id", this.deleteTodo);
    this.express.post("/users", this.makeaccount);
    this.express.post("/users/:username", this.login);
    // post is used to hide password. However, username is still visible in an attempt to make it restful ('creating' an api token)
    this.express.listen(3000);
    console.log(`Server started at http://localhost:3000/`)
    console.log(`Basic Documentation:
    
    This is a restful API representing a todolist and users. 
    
    Make an account by POSTing /users with a json containing username and password.
    The response body will include an idtoken which you can use to authenticate.
    
    Log into (get the id token for) an existing account by POSTing /users/:username, with a json containing password.
    The response body will include an idtoken which you can use to authenticate.
    
    If you want to test making/reading/editing/deleting posts: there is a default account with username "admin" and idtoken "faketoken".
    
    GETting /todo will return the URIs of all the todos, no matter what user.
    GETting /todo with ?field=:field&search=:search, with
    - field in ["owner", "title", "content"] and
    - search of type string
    will search for all todo items with the relevant field including the search string.
    
    POSTing /todo will add a new todo. Make sure to include:
    - title: string
    - content: string
    - owner: string
    - idtoken: hex string
    
    You can also GET, PUT, and DELETE /todo/:id.
    - GET: return the contents of. 
    - PUT: modify the title and content to what you sent. same arguments as POSTing /todo.
    - DELETE: delete the relevant todo item. Only owner and idtoken are required.
    
    All other endpoints will return a 404.
    `)
  }

  makeaccount = (req, res) => {
    let body = req.body;
    if (!body.username || !body.password) {
      // malformed
      return res.status(400).end();
    }
    let owners = this.users.filter((item) => item.name === body.username);
    if (owners.length !== 0) {
      // another user already exists with that id
      return res.status(422).end();
    }
    let new_idtoken = crypto.randomBytes(64).toString("hex");
    let new_salt = crypto.randomBytes(16).toString("hex");
    let new_user = {
      idtoken: new_idtoken,
      name: body.username,
      salt: new_salt,
      passwordHash: crypto
        .pbkdf2Sync(body.password, new_salt, 1000, 64, "sha512")
        .toString("hex"),
    };
    this.users.push(new_user);
    return res
      .setHeader("Content-Type", "application/json")
      .status(200)
      .end(JSON.stringify(new_idtoken));
  };

  login = (req, res) => {
    let username = req.params.username;
    let body = req.body;
    if (!body.password) {
      // malformed
      return res.status(400).end();
    }
    let owners = this.users.filter((item) => item.name === username);
    if (owners.length === 0) {
      return res.status(403).end();
    }
    let hashedPassword = crypto
      .pbkdf2Sync(body.password, owners[0].salt, 1000, 64, "sha512")
      .toString("hex");
    if (hashedPassword !== owners[0].passwordHash) {
      return res.status(403).end();
    }
    let new_idtoken = crypto.randomBytes(64).toString("hex");
    owners[0].idtoken = new_idtoken;
    return res
      .setHeader("Content-Type", "application/json")
      .status(200)
      .end(JSON.stringify(new_idtoken));
  };

  getTodos = (req, res) => {
    if (
      ["owner", "title", "content"].includes(req.query.field) &&
      req.query.search
    ) {
      return res
        .setHeader("Content-Type", "application/json")
        .status(200)
        .end(
          JSON.stringify(
            this.todos
              .filter((item) => satisfiesQuery(req.query, item))
              .map((item) => `http://localhost:3000/todo/${item.id}`)
          )
        );
    }
    return res
      .setHeader("Content-Type", "application/json")
      .status(200)
      .end(
        JSON.stringify(
          this.todos.map((item) => `http://localhost:3000/todo/${item.id}`)
        )
      );
  };

  getTodo = (req, res) => {
    let id = Number(req.params.id);
    let todo = this.todos.filter((item) => item.id === id);
    if (todo.length === 0) {
      // not present
      return res.status(404).end();
    }
    return res
      .setHeader("Content-Type", "application/json")
      .status(200)
      .send(JSON.stringify(todo[0]));
  };

  addTodo = (req, res) => {
    var body = req.body;
    if (!body.title || !body.content) {
      // malformed
      return res.status(400).end();
    }
    if (!body.owner || !body.idtoken) {
      // not authenticated
      return res.status(401).end();
    }
    let owners = this.users.filter((item) => item.name === body.owner);
    if (owners.length == 0 || owners[0].idtoken != body.idtoken) {
      // authentication wrong
      return res.status(403).end();
    }
    this.todos.push({
      title: body.title,
      owner: body.owner,
      content: body.content,
      id: this.counter,
    });
    this.counter++;
    return res
      .setHeader("Content-Type", "application/json")
      .status(201)
      .end(`http://localhost:3000/todo/${this.counter - 1}`);
  };

  editTodo = (req, res) => {
    let id = Number(req.params.id);
    let todo = this.todos.filter((item) => item.id === id);
    if (todo.length === 0) {
      // not present, 404
      return res.status(404).end();
    }
    var body = req.body;
    if (!body.content || !body.title) {
      // malformed
      return res.status(400).end();
    }
    if (!body.owner || !body.idtoken) {
      // not authenticated
      return res.status(401).end();
    }
    let owners = this.users.filter((item) => item.name === body.owner);
    if (
      owners.length === 0 ||
      owners[0].idtoken != body.idtoken ||
      body.owner != todo[0].owner
    ) {
      // authentication wrong
      return res.status(403).end();
    }
    todo[0].content = body.content;
    todo[0].title = body.title;
    return res.status(204).end();
  };

  deleteTodo = (req, res) => {
    let id = Number(req.params.id);
    let todo = this.todos.filter((item) => item.id === id);
    if (todo.length === 0) {
      // not present, 404
      return res.status(404).end();
    }
    var body = req.body;
    if (!body.owner || !body.idtoken) {
      // not authenticated
      return res.status(401).end();
    }
    let owners = this.users.filter((item) => item.name === body.owner);
    if (
      owners.length === 0 ||
      owners[0].idtoken != body.idtoken ||
      body.owner != todo[0].owner
    ) {
      // authentication wrong
      return res.status(403).end();
    }
    this.todos = this.todos.filter((item) => item !== todo[0]);
    return res.status(204).end();
  };
}

new Server();
