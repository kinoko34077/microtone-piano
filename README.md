# Multi-stage Microtonal Web Keyboard

This repository contains a Vite + React web app for a microtonal keyboard UI.

## Local development

Prerequisite: Node.js 20 or later.

1. Install dependencies:
   `npm install`
2. Start the dev server:
   `npm run dev`
3. Create a production build:
   `npm run build`

## GitHub Pages deployment

The app is configured with a relative Vite `base` path, so it can be hosted from a GitHub Pages project URL such as `https://<account>.github.io/<repo>/` without hardcoding the repository name.

## PWA support

The app now includes:

- a web app manifest
- installable app icons
- a service worker for app-shell and asset caching

After deploying the production build over HTTPS, supported browsers can install it as a standalone app.

### One-time GitHub setup

1. Push this repository to GitHub.
2. In the repository settings, open `Pages`.
3. Set `Source` to `GitHub Actions`.

### Deploy flow

- The workflow at `.github/workflows/deploy-pages.yml` runs on every push to `main`.
- It installs dependencies, builds the app, uploads `dist`, and deploys it to GitHub Pages.

If you use a branch other than `main`, update the workflow trigger accordingly.
