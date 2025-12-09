import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';


export default function Signup() {
  const [formData, setFormData] = useState({
    nombre: '',
    apellido: '',
    password: '',
    repeatPassword: ''
  });
  const [errorMessage, setErrorMessage] = useState('');
  const [dominiosFiltrados, setDominiosFiltrados] = useState([]);
  // Visualizar Contraseña:
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeatPassword, setShowRepeatPassword] = useState(false);
  // Toggle functions
  const togglePassword = () => setShowPassword(prev => !prev);
  const toggleRepeatPassword = () => setShowRepeatPassword(prev => !prev);

  // 👉 ESTA FUNCIÓN FALTABA
    const handleChange = (e) => {
      const { name, value } = e.target;
      setFormData((prevData) => ({
        ...prevData,
        [name]: value,
      }));
    };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { nombre, apellido, password, repeatPassword } = formData;

    if (!nombre || !apellido || !password || !repeatPassword) {
      setErrorMessage('Todos los campos son obligatorios');
      return;
    }

    if (password !== repeatPassword) {
      setErrorMessage('Las contraseñas no coinciden');
      return;
    }


    const correo = `${nombre}${apellido}@quick.com`.toLowerCase();

    // Enviar a la API
    try {
      await axios.post('/api/registro', {
        nombre,
        apellido,
        contrasena: password,
       
      });
      setErrorMessage('');
      alert('Usuario registrado con éxito');
    } catch (err) {
      setErrorMessage('Error al registrar usuario');
    }
  };

  return (
    <div className="flex h-screen w-screen justify-center items-center bg-[url('/bg-login.jpeg')] bg-cover bg-right overflow-hidden">
      <div className="bg-white rounded-2xl p-8 w-full max-w-md flex flex-col items-center">
        <h1 className="text-5xl font-extrabold uppercase mb-6 text-gray-900">Registro</h1>
        {errorMessage && <p className="text-red-500 mb-3">{errorMessage}</p>}
        <form onSubmit={handleSubmit} className="form-but w-full flex flex-col gap-3">
          <div>
            <label htmlFor="nombre-input">
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
                <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Z" />
              </svg>
            </label>
            <input
              type="text"
              name="nombre"
              id="nombre-input"
              placeholder="Nombre"
              className="p-2 w-52 rounded-r-lg border-2 border-purple-200 focus:border-gray-900 outline-none"
              value={formData.nombre}
              onChange={handleChange}
            />
          </div>
          <div>
            <label htmlFor="apellido-input">
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
                <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Z" />
              </svg>
            </label>
            <input
              type="text"
              name="apellido"
              id="apellido-input"
              placeholder="Apellido"
              className="p-2 w-52 rounded-r-lg border-2 border-purple-200 focus:border-gray-900 outline-none"
              value={formData.apellido}
              onChange={handleChange}
            />
          </div>

          <div className="relative">
            <label htmlFor="password-input">
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
                <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm240-200q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Z" />
              </svg>
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              id="password-input"
              placeholder="Contraseña"
              className="p-2 w-52 rounded-r-lg border-2 border-purple-200 focus:border-gray-900 outline-none"
              value={formData.password}
              onChange={handleChange}
            />
            <button-s
              type="button"
              onClick={togglePassword}
              className="absolute right-18 top-8 transform -translate-y-3/4 text-gray-500 hover:text-gray-700"
              tabIndex={-1}
            >
              {showPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-5.523 0-10-4.477-10-10 0-1.018.15-2.002.425-2.938M5.635 5.635l12.73 12.73" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-.035.108-.078.213-.126.316" />
                </svg>
              )}
            </button-s>
          </div>
          <div className="relative">
            <label htmlFor="repeat-password-input">
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
                <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm240-200q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Z" />
              </svg>
            </label>
            <input
              type={showRepeatPassword ? 'text' : 'password'}
              name="repeatPassword"
              id="repeat-password-input"
              placeholder="Repetir Contraseña"
              className="p-2 w-52 rounded-r-lg border-2 border-purple-200 focus:border-gray-900 outline-none"
              value={formData.repeatPassword}
              onChange={handleChange}
            />
            <button-s
              type="button"
              onClick={toggleRepeatPassword}
              className="absolute right-18 top-8 transform -translate-y-3/4 text-gray-500 hover:text-gray-700"
              tabIndex={-1}
            >
              {showRepeatPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-5.523 0-10-4.477-10-10 0-1.018.15-2.002.425-2.938M5.635 5.635l12.73 12.73" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-.035.108-.078.213-.126.316" />
                </svg>
              )}
            </button-s>
          </div>
          
  
          <button type="submit" className="bg-purple-600 text-white p-2 rounded">Registrar</button>
        </form>
        <p className="mt-3">¿Ya tienes una cuenta? <Link to="/">Iniciar Sesión</Link></p>
      </div>
    </div>
  );
}
