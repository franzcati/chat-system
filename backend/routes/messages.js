// routes/messages.js
const express = require('express');
const router = express.Router();

let messages = [
  { id: 1, content: 'Hola mundo' },
  { id: 2, content: 'Mensaje de prueba' }
];

// GET /api/messages
router.get('/', (req, res) => {
  res.json(messages);
});

// POST /api/messages
router.post('/', (req, res) => {
  const { content } = req.body;
  const newMessage = { id: Date.now(), content };
  messages.push(newMessage);
  res.status(201).json(newMessage);
});

module.exports = router;