import './ui/styles.css';
import { App } from './app/App.js';

const ui = document.getElementById('ui')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;

try {
  new App(ui, canvas).start();
} catch (err) {
  console.error(err);
  ui.innerHTML = `<div class="screen"><div class="center-msg"><div class="title">Falha ao iniciar</div><p class="hint">${
    err instanceof Error ? err.message : String(err)
  }<br/>Verifique se o navegador suporta WebGL2.</p></div></div>`;
}
