const start = document.querySelector('#start');
const scene = document.querySelector('#scene');
const message = document.querySelector('#error');

// Begin rendering the grid immediately. The game clock and model loading start on click.
const ready = import('../main.js').then(({ createViewport }) => createViewport(scene), error => {
  message.textContent = 'The scene could not be loaded. Please reload to try again.';
  throw error;
}).catch(error => {
  console.error(error);
  return null;
});

start.addEventListener('click', async () => {
  start.disabled = true;
  document.querySelector('#landing').hidden = true;
  scene.inert = false;
  scene.focus({ preventScroll: true });
  const play = await ready;
  if (!play) {
    message.hidden = false;
    return;
  }
  try {
    play();
  } catch (error) {
    message.textContent = 'The scene could not be loaded. Please reload to try again.';
    message.hidden = false;
    console.error(error);
  }
}, { once: true });
