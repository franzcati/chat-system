import React, { useState } from "react";

import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js"; // 👈 IMPORTANTE
import "bootstrap-icons/font/bootstrap-icons.css";
import '../App.css';
import '../css/ChatBox.css';

const AddUsers = ({ proyectos = [], onCancel }) => {
  
  const [rows, setRows] = useState([
    { nombre: "", apellido: "", usuario: "", password: "", proyecto: "" },
    { nombre: "", apellido: "", usuario: "", password: "", proyecto: "" },
  ]);

  const addRow = () => {
    setRows([
      ...rows,
      { nombre: "", apellido: "", usuario: "", password: "", proyecto: "" },
    ]);
  };

  const removeRow = () => {
    if (rows.length > 1) {
      setRows(rows.slice(0, -1));
    }
  };

  const handleChange = (index, field, value) => {
    const updated = [...rows];
    updated[index][field] = value;
    setRows(updated);
  };

  const handleSubmit = async () => {
    try {
      const resp = await fetch("/api/addusers/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuarios: rows })
      });

      const data = await resp.json();

      if (!resp.ok) {
        alert(data.error);
        return;
      }

      alert("Usuarios creados correctamente");
      onCancel(); // Cierra modal
    } catch (err) {
      console.error("Error:", err);
    }
  };

  return (
    <div className="p-6 w-full">
      <h2 className="text-3xl font-semibold mb-6">Agregar lista de usuarios</h2>

      <div className="flex gap-4 mb-6">
        <button
          onClick={addRow}
          className="px-4 py-2 bg-blue-500 text-white rounded shadow"
        >
          + Agregar fila
        </button>

        <button
          onClick={removeRow}
          className="px-4 py-2 bg-red-500 text-white rounded shadow"
        >
          – Eliminar fila
        </button>
      </div>

      <div className="titles-row">
        <span>Nombre</span>
        <span>Apellido</span>
        <span>Usuario</span>
        <span>Contraseña</span>
        <span>Proyecto</span>
      </div>

      {rows.map((row, index) => (
        <div key={index} className="form-row w-full grid grid-cols-5 gap-4 mb-4">

          {/* NOMBRE */}
          <div className="field flex flex-row items-center">
            <label className="bg-purple-600 text-white rounded-l-lg flex items-center justify-center w-12 h-12">
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
                <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Z" />
              </svg>
            </label>

            <input
              className="p-2 w-full rounded-r-lg border-2 border-purple-200 focus:border-gray-900 outline-none"
              placeholder="Nombre"
              value={row.nombre}
              onChange={(e) => handleChange(index, "nombre", e.target.value)}
            />
          </div>

          {/* APELLIDO */}
          <div className="field flex flex-row items-center">
            <label className="bg-purple-600 text-white rounded-l-lg flex items-center justify-center w-12 h-12">
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
                <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Z" />
              </svg>
            </label>

            <input
              className="p-2 w-full rounded-r-lg border-2 border-purple-200 focus:border-gray-900 outline-none"
              placeholder="Apellido"
              value={row.apellido}
              onChange={(e) => handleChange(index, "apellido", e.target.value)}
            />
          </div>

          {/* USUARIO */}
          <div className="field flex flex-row items-center">
            <label className="bg-purple-600 text-white rounded-l-lg flex items-center justify-center w-12 h-12">
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
                <path d="M120-200v-80q0-33 17.5-60t46.5-42q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 42t17.5 60v80H120Zm360-280q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Z" />
              </svg>
            </label>

            <input
              className="p-2 w-full rounded-r-lg border-2 border-purple-200 focus:border-gray-900 outline-none"
              placeholder="Usuario o correo"
              value={row.usuario}
              onChange={(e) => handleChange(index, "usuario", e.target.value)}
            />
          </div>

          {/* CONTRASEÑA */}
          <div className="field flex flex-row items-center">
            <label className="bg-purple-600 text-white rounded-l-lg flex items-center justify-center w-12 h-12">
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
                <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm240-200q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Z" />
              </svg>
            </label>

            <input
              className="p-2 w-full rounded-r-lg border-2 border-purple-200 focus:border-gray-900 outline-none"
              placeholder="Contraseña"
              value={row.password}
              onChange={(e) => handleChange(index, "password", e.target.value)}
            />
          </div>

          {/* PROYECTO */}
          <div className="field flex flex-row items-center">
            <label className="bg-purple-600 text-white rounded-l-lg flex items-center justify-center w-12 h-12">
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
                <path d="M160-120v-720h640v720H160Zm80-80h480v-560H240v560Zm120-80h240v-80H360v80Zm0-160h240v-80H360v80Zm0-160h240v-80H360v80Z" />
              </svg>
            </label>

            <select
              className="p-2 w-full rounded-r-lg border-2 border-purple-200 focus:border-gray-900 outline-none"
              value={row.proyecto}
              onChange={(e) => handleChange(index, "proyecto", e.target.value)}
            >
              <option value="">Lista de proyectos</option>

              {proyectos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>

        </div>
      ))}

      <div className="flex justify-end mt-8 gap-4">
        <button
          onClick={handleSubmit}
          className="px-6 py-2 bg-green-400 text-white rounded shadow"
        >
          Agregar
        </button>

        <button
          onClick={onCancel}
          className="px-6 py-2 bg-gray-400 text-white rounded shadow"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
};

export default AddUsers;