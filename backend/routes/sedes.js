const express = require('express');
const router = express.Router();
const Sede = require('../models/Sede');

router.get('/', async (req, res) => {
  try {
    const sedes = await Sede.findAll();
    res.json(sedes);
  } catch (error) {
    console.error('❌ Error al obtener sedes:', error);
    res.status(500).json({ error: 'Error al obtener sedes' });
  }
});

module.exports = router;