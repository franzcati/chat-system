const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Sede = sequelize.define('Sede', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tipo: {
    type: DataTypes.STRING,
    allowNull: false
  },
  dominio: {
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  tableName: 'sede',
  timestamps: false // asumiendo que tu tabla no tiene columnas `createdAt` o `updatedAt`
});

module.exports = Sede;