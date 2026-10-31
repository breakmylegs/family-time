import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import '@family-time/tokens/tokens.css';
import './styles.css';
import { render } from 'preact';
import { App } from './App';

render(<App />, document.getElementById('app')!);
