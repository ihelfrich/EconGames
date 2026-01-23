# Quick Start Guide - EconGames

Get your world-class economics simulator running in **under 5 minutes**.

## Prerequisites

- Node.js 18+ installed ([download here](https://nodejs.org/))
- Git installed
- A GitHub account

## Step 1: Test Locally (2 minutes)

```bash
# You're already in the project directory
cd /Users/ian/gemini_playground/EconGames

# Install dependencies (if not already done)
npm install

# Start development server
npm run dev
```

**Open browser to http://localhost:3000**

### What to Test:

1. ✅ See cute blue (buyers) and green (sellers) sprites moving
2. ✅ Watch trades happen (golden lines and particles)
3. ✅ Click different market mode buttons
4. ✅ Adjust sliders to change agent counts
5. ✅ Observe supply/demand chart updating

**Everything working? Proceed to deployment!**

---

## Step 2: Deploy to GitHub Pages (3 minutes)

### Option A: Automatic Deployment (Recommended)

```bash
# Initialize git repository
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: World-class economics simulator by Dr. Ian Helfrich"

# Set main branch
git branch -M main

# Add remote repository
git remote add origin https://github.com/ihelfrich/EconGames.git

# Push to GitHub
git push -u origin main
```

### Enable GitHub Pages:

1. Go to https://github.com/ihelfrich/EconGames/settings/pages
2. Under "Build and deployment":
   - Source: **GitHub Actions**
3. Click "Save"

**That's it!** GitHub will automatically build and deploy.

### Check Deployment Status:

1. Go to https://github.com/ihelfrich/EconGames/actions
2. Watch the "Deploy to GitHub Pages" workflow
3. Once complete (green checkmark), visit:

**🎉 https://ihelfrich.github.io/EconGames/ 🎉**

---

## Step 3: Make Updates (30 seconds)

Anytime you want to update the live site:

```bash
# Make your changes...

# Commit and push
git add .
git commit -m "Update: [describe your changes]"
git push
```

**GitHub automatically rebuilds and redeploys!**

---

## Troubleshooting

### "npm: command not found"
- Install Node.js from https://nodejs.org/

### "git: command not found"
- Install Git from https://git-scm.com/

### Port 3000 already in use
```bash
# Use a different port
npm run dev -- --port 3001
```

### GitHub Pages shows 404
- Wait 2-3 minutes for first deployment
- Check Actions tab for deployment status
- Ensure repository name is exactly "EconGames"

### Sprites not moving
- Check browser console (F12) for errors
- Ensure JavaScript is enabled
- Try a different browser (Chrome recommended)

---

## Key Files to Know

- **`src/engine/Market.ts`** - Economic logic
- **`src/game/MainScene.ts`** - Visual rendering
- **`index.html`** - UI layout and controls
- **`vite.config.ts`** - Build settings (change `base` if repo name changes)

---

## Next Steps

### Customize Your Simulator:

1. **Change Colors**: Edit sprite colors in `MainScene.ts`
2. **Adjust Economics**: Modify utility/cost functions in `MainScene.ts`
3. **Add Features**: See `ARCHITECTURE.md` for extension points
4. **Enhance Visuals**: See `SPRITE_ENHANCEMENT_IDEAS.md`

### Share Your Work:

- Tweet the live link
- Share in economics education communities
- Submit to educational resource directories
- Present at conferences

### Get Feedback:

Open an issue on GitHub or share with colleagues for suggestions.

---

## One-Liner for Future Reference

```bash
npm install && npm run dev  # Local testing
npm run build               # Production build
git add . && git commit -m "Update" && git push  # Deploy
```

---

**Congratulations!**

You now have a **world-class, interactive economics simulator** running live on the web.

Built by **Dr. Ian Helfrich** with cutting-edge technology and rigorous economic theory.

**Live at**: https://ihelfrich.github.io/EconGames/

---

## Resources

- **Full Documentation**: [README.md](README.md)
- **Technical Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md)
- **Deployment Details**: [DEPLOYMENT.md](DEPLOYMENT.md)
- **Project Summary**: [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)

**Questions?** Check these files or the code comments.
