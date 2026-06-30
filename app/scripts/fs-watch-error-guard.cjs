const fs = require('node:fs')

const originalWatch = fs.watch
let warned = false

fs.watch = function watchWithEmfileGuard(...args) {
  const watcher = originalWatch.apply(this, args)

  watcher.on('error', (error) => {
    if (error && error.code === 'EMFILE') {
      if (!warned) {
        warned = true
        console.warn(
          'Ignored fs.watch EMFILE from the dev server. File reload for that watcher may be disabled.',
        )
      }
      return
    }

    queueMicrotask(() => {
      throw error
    })
  })

  return watcher
}
