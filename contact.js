const contactButton = document.getElementById('contactBtn');
const contactDialog = document.getElementById('contactDialog');
const closeContactButton = document.getElementById('closeContactBtn');

contactButton.addEventListener('click', () => contactDialog.showModal());
closeContactButton.addEventListener('click', () => contactDialog.close());
contactDialog.addEventListener('close', () => contactButton.focus());
contactDialog.addEventListener('click', event => {
  if (event.target !== contactDialog) return;
  const bounds = contactDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) contactDialog.close();
});
