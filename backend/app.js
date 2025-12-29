require('dotenv').config(); // <- Aquí al principio

const express = require('express');
const cors = require('cors');
const app = express();

app.set("trust proxy", true);

const signupRoutes = require('./routes/signup'); // ⬅️ Importa las rutas

app.use(cors());
app.use(express.json());

// REGISTRO (SIGNUP)
app.use('/api/registro', signupRoutes); // ⬅️ Ahora puedes acceder a /api/signup/messages

// SEDES
const sedesRoutes = require('./routes/sedes');
app.use('/api/sedes', sedesRoutes);

// MESSAGES
const messagesRoutes = require('./routes/messages');
app.use('/api/messages', messagesRoutes);

//LOGIN
app.use('/api/usuario', require('./routes/usuario'));

//BUSQUEDA DE CHAT
const chats = require('./routes/chats');
app.use('/api/chats', chats);

//PROYECTOS
app.use("/api/proyecto", require("./routes/proyecto"));

//AGREGAR USUARIOS NUEVOS
app.use("/api/addusers", require("./routes/addusers"));

//FUNCION PARA USUARIOS
app.use("/api/usuarios", require("./routes/usuarios"));

//FUNCION PARA ROLES
app.use("/api/roles", require("./routes/roles"));

//FUNCION PARA PERMISOS DE ROLES
app.use("/api/roles_permisos", require("./routes/roles_permisos"));

const gruposRoutes = require("./routes/grupos");
app.use("/api/grupos", gruposRoutes);

const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Aquí se agregarán las rutas más adelante
app.get('/', (req, res) => {
  res.send('API Chat funcionando');
});

module.exports = app;