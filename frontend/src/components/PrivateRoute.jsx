// components/PrivateRoute.jsx
import { Navigate } from 'react-router-dom';

export default function PrivateRoute({ children }) {
  const isAuthenticated = localStorage.getItem('usuario');
  return isAuthenticated ? children : <Navigate to="/" />;
}