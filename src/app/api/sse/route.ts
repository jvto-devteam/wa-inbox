import { subscribe } from '@/lib/realtime'

export async function GET() {
  // `cleanup` is captured via closure rather than attached to the controller/`this`,
  // because ReadableStream's `cancel()` callback runs with `this` bound to the
  // underlying-source object literal, not to the controller passed into `start()` — so a
  // `controller._cleanup = ...` / `this._cleanup?.()` pairing (as sketched in the task
  // brief) never actually connects and the unsubscribe + keepAlive interval would leak on
  // every client disconnect.
  let cleanup: (() => void) | undefined
  const stream = new ReadableStream({
    start(controller) {
      const unsubscribe = subscribe((event) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
      })
      const keepAlive = setInterval(() => controller.enqueue(': ping\n\n'), 25000)
      cleanup = () => {
        unsubscribe()
        clearInterval(keepAlive)
      }
    },
    cancel() {
      cleanup?.()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}
