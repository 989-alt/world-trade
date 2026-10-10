import { render } from 'preact';
import { App } from './app';
import { boot } from './game/boot';
import './styles/tokens.css';
import './styles/base.css';

render(<App />, document.getElementById('ui')!);
boot();
