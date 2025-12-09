import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'; // 👈 Añade esta línea
import { Toaster } from "react-hot-toast";

import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js"; // 👈 IMPORTANTE
import "bootstrap-icons/font/bootstrap-icons.css";
import './App.css';
import './css/ChatBox.css';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Messenger from './pages/Messenger';
import PrivateRoute from './components/PrivateRoute';


function App() {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');

  // Obtener mensajes del backend
  const fetchMessages = async () => {
    try {
      const res = await fetch('/api/messages');
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      console.error('Error al obtener mensajes:', err);
    }
  };

  // Enviar mensaje al backend
  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newMessage })
      });

      if (res.ok) {
        setNewMessage('');
        fetchMessages(); // Recargar mensajes
      }
    } catch (err) {
      console.error('Error al enviar mensaje:', err);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/mensajes" element={
          <PrivateRoute>
            <Messenger />
          </PrivateRoute>
        } />
      </Routes>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
    </Router>
    
  );
}

export default App;