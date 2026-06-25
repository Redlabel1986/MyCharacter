export default defineAppConfig({
  ui: {
    colors: {
      primary: 'sky',
      neutral: 'slate',
    },
    // Eigene Klasse global an den Modal-Content anhängen (additiv, ersetzt die
    // Default-Klassen nicht) — gibt Modals beim Öffnen einen dezenten Spring-Pop.
    // Animation + reduced-motion in main.css (.modal-spring).
    modal: {
      slots: {
        content: 'modal-spring',
      },
    },
  },
})
