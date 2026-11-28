import { createRoot } from 'react-dom/client';
import { App } from './App';
import './tokens.css';
import './style.css';
import './glass-light.css';
import './glass-layout.css';
import './pose-layout.css';
import './flow-layout.css';
import './archive.css';
import './compare.css';

createRoot(document.getElementById('root')!).render(<App />);

