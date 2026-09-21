# Focus Room — a disposable CharaDock demo

This is a local, fictional studio landing page used to demonstrate a real
screen-informed coding task. It intentionally starts with a clipped session
grid. No real customer, payment, or booking data is involved.

Open `index.html` in a browser. The page has no dependencies or network calls.
The session cards should fit the available width on desktop and on a 390px-wide
phone. Preserve the visual identity and all three session options when fixing
the layout. Keep modifications inside this demo folder.

The booking buttons select a session locally; they do not submit anything.

Run `node verify-layout.cjs` to check the real rendered page at desktop (980px)
and phone (390px) widths using an installed Chrome or Edge. This should fail
before the layout is fixed. It also exercises all three session buttons and
writes `layout-check.json`. Do not weaken the check to make it pass.
