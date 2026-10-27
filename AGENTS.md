<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Shared dashboard layout and UI primitives live in src/components/app-shell.tsx; sample data in src/lib/sample-data.ts (prototype, no backend yet).
- The chat widget is public/widget.js (loader that injects an iframe) + /widget route; widget and Inbox sync via src/lib/chat-store.ts (localStorage + BroadcastChannel, same-origin only) until a real backend exists. Routes starting with /widget render without AppShell.
