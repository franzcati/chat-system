import { useState } from 'react';
import { Link } from 'react-router-dom'; // 👈 Esto es lo que faltaba
import { useNavigate } from 'react-router-dom';
import { logDev } from "../utils/logger";
import axios from 'axios';


function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!email.includes('@')) {
      setError('Email inválido');
      return;
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    try {
      const res = await axios.post('/api/usuario/login', {
        correo: email,
        contrasena: password,
      });

      logDev('Login exitoso:', res.data);
      setError('');
      // ✅ Guardar usuario en localStorage
      localStorage.setItem('usuario', JSON.stringify(res.data.usuario));

      // Redirigir a /mensajes
      navigate('/mensajes');
    } catch (err) {
      if (err.response) {
        setError(err.response.data.error); // Mensaje del servidor
      } else {
        setError('Error de conexión');
      }
    }
  };

  return (
    <div className="flex h-screen w-screen justify-center items-center bg-[url('/bg-login.jpeg')] bg-cover bg-right overflow-hidden">
      <div className="bg-white rounded-2xl p-8 w-full max-w-md flex flex-col items-center">
        <h1 className="text-5xl font-extrabold uppercase mb-6 text-gray-900">Login</h1>

        {error && <p className="text-red-500 mb-4">{error}</p>}

        <form onSubmit={handleLogin} className="form-but w-full flex flex-col gap-4">
          <div className="flex">
            <label
              htmlFor="email-input"
              className="bg-purple-600 text-white rounded-l-lg flex items-center justify-center w-12"
            >
              <span>@</span>
            </label>
            <input
              id="email-input"
              type="email"
              placeholder="Email"
              className="flex-grow p-2 rounded-r-lg border-2 border-purple-200 focus:border-gray-900 outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="flex">
            <label
              htmlFor="password-input"
              className="bg-purple-600 text-white rounded-l-lg flex items-center justify-center w-12"
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm240-200q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Z"/></svg>
            </label>
            <input
              id="password-input"
              type="password"
              placeholder="Password"
              className="flex-grow p-2 rounded-r-lg border-2 border-purple-200 focus:border-gray-900 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-full uppercase font-semibold transition"
          >
            Ingresar
          </button>
        </form>
        {/* 
        <p className="mt-6 text-sm">
          Nuevo Usuario?{' '}
          <Link to="/signup" className="text-purple-600 underline">
            Crear Cuenta
          </Link>
        </p>
        */}
      </div>
    </div>
  );
}

export default Login;