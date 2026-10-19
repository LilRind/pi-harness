import { createApp } from 'vue'
import EvalStudioApp from './EvalStudioApp.vue'

const host = document.querySelector<HTMLDivElement>('#eval-studio-app')
if (host) {
  createApp(EvalStudioApp, {
    token: new URLSearchParams(window.location.search).get('token') ?? ''
  }).mount(host)
}
