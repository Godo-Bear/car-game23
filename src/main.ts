import './styles.css';
import { Game } from './game/Game';

function showFatal(message: string): void {
  const loading = document.getElementById('loading');
  if (loading)
    loading.innerHTML = `<div class="loading-title"><img class="logo-mark" src="./logo.svg" alt="" /><span class="logo-text"><b>TOKYO CIRCUIT</b><small>RACER</small></span></div><p class="muted" style="max-width:420px;text-align:center">${message}</p>`;
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const probe = document.createElement('canvas');
if (!probe.getContext('webgl2')) {
  showFatal('This game needs WebGL 2. Please use an up-to-date Chrome, Edge, Firefox or Safari with hardware acceleration enabled.');
} else {
  const game = new Game(canvas);
  // Development only: `?debug` exposes the game object for the preview renderer and console tinkering.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('debug')) (window as unknown as { game: Game }).game = game;
  game.init().catch((err: unknown) => {
    console.error(err);
    showFatal('Something went wrong while loading the game. Check the browser console for details.');
  });
}
