import { render } from 'preact';
import { App } from './app';
import { initAudio } from './audio/audio';
import { boot } from './game/boot';
import './styles/tokens.css';
import './styles/base.css';

// 1280×720 스테이지를 화면에 맞춘다. CSS 의 100vw/1280 은 길이값이라 scale() 이 무효 → 단위 없는 수를 JS 로 넣는다
const fit = () =>
  document.documentElement.style.setProperty('--stage-scale', String(Math.min(window.innerWidth / 1280, window.innerHeight / 720)));
fit();
window.addEventListener('resize', fit);

initAudio();
render(<App />, document.getElementById('ui')!);
boot();
