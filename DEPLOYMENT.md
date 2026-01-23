# Deployment Guide for EconGames

## Initial Setup

### 1. Push to GitHub

First, initialize git and push to your repository:

```bash
git init
git add .
git commit -m "Initial commit: World-class economics simulator"
git branch -M main
git remote add origin https://github.com/ihelfrich/EconGames.git
git push -u origin main
```

### 2. Enable GitHub Actions

The project includes an automated deployment workflow at `.github/workflows/deploy.yml`.

To enable it:
1. Go to your repository on GitHub
2. Click on "Settings" → "Pages"
3. Under "Build and deployment", select **Source: GitHub Actions**

### 3. Trigger Deployment

Every push to the `main` branch will automatically:
- Install dependencies
- Run TypeScript type checking
- Build the production bundle
- Deploy to GitHub Pages

You can also manually trigger the workflow:
1. Go to "Actions" tab
2. Select "Deploy to GitHub Pages"
3. Click "Run workflow"

### 4. Access Your Live Site

Once deployed, your site will be available at:
**https://ihelfrich.github.io/EconGames/**

## Manual Deployment (Alternative)

If you prefer manual deployment:

```bash
# Build the project
npm run build

# Create gh-pages branch and deploy
git add dist -f
git commit -m "Deploy to GitHub Pages"
git subtree push --prefix dist origin gh-pages
```

Then configure GitHub Pages to use the `gh-pages` branch.

## Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open browser to http://localhost:3000
```

## Troubleshooting

### Build Fails
- Ensure Node.js version 18+ is installed
- Run `npm ci` to do a clean install
- Check TypeScript errors with `npm run typecheck`

### GitHub Pages Shows 404
- Ensure `base` in `vite.config.ts` matches your repo name
- Verify GitHub Pages is configured correctly in Settings
- Wait a few minutes for deployment to complete

### Assets Not Loading
- Check browser console for errors
- Verify `base: '/EconGames/'` in vite.config.ts matches your repository name exactly

## Performance Optimization

The build is already optimized with:
- Code splitting (Phaser and Chart.js as separate chunks)
- Minification and compression
- Tree shaking for unused code

For further optimization:
- Enable gzip compression on your server
- Consider using a CDN for static assets
- Implement service worker for offline support

## Updating the Site

Simply push changes to the main branch:

```bash
git add .
git commit -m "Update: [description]"
git push
```

GitHub Actions will automatically rebuild and redeploy.

## Custom Domain (Optional)

To use a custom domain:

1. Add a `public/CNAME` file with your domain:
   ```
   econgames.yourdomain.com
   ```

2. Configure DNS:
   - Add a CNAME record pointing to `ihelfrich.github.io`
   - Or A records to GitHub's IPs

3. Enable HTTPS in GitHub Pages settings

---

**Built by Dr. Ian Helfrich**
