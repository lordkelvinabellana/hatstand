import { createRoot } from 'react-dom/client';
import { NotesApp } from './NotesApp.tsx';
import '../ui/style.css';
import './notes.css';

createRoot(document.getElementById('root')!).render(<NotesApp />);
