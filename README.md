# EconGames - Interactive Microeconomics Simulator

**By Dr. Ian Helfrich**

An innovative, world-class interactive economics simulator that brings microeconomic theory to life through engaging gameplay with animated sprites. Built with TypeScript, Phaser 3, and Chart.js.

## New: EconTwin, a living synthetic America

`twin.html` is the first slice of a digital twin of the U.S. economy: 466,000
synthetic people placed on real county data (age, sex, race, education, jobs and
pay by industry, health, votes), an agent-based labor market, and a
data-assimilation loop that re-anchors the twin to every BLS jobs report. You
watch it on an isometric map, click counties to meet their residents, follow
one through the pandemic, and fork the timeline to test what-ifs.

- Play: `npm run dev`, then open http://localhost:3000/EconGames/twin.html
- Check it against history: `npm run twin:backtest`
- How it works, results, and how to add your own mechanism: [docs/TWIN.md](docs/TWIN.md)

## Features

### Market Structures
- **Perfect Competition**: Many buyers and sellers, price-taking behavior, market equilibrium
- **Monopoly**: Single seller with price-setting power, restricted output
- **Oligopoly**: Few strategic sellers, Cournot-style competition
- **Monopolistic Competition**: Many sellers with differentiated products

### Interactive Elements
- Real-time supply and demand curve visualization
- Animated cute sprites representing buyers (blue circles) and sellers (green squares)
- Live transaction effects with particle animations
- Dynamic agent spawning and removal
- Adjustable market parameters (number of agents, trade speed)

### Economic Accuracy
- Agent-based modeling with utility and cost functions
- Diminishing marginal utility for buyers
- Increasing marginal costs for sellers
- Proper surplus calculations (consumer and producer)
- Deadweight loss estimation for imperfect markets
- Adaptive learning behavior in agents

## Quick Start

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open your browser to `http://localhost:3000`

### Build for Production

```bash
npm run build
```

The output will be in the `dist/` directory, ready for GitHub Pages deployment.

## Deployment to GitHub Pages

### Automated Deployment with GitHub Actions (Recommended)

This project uses GitHub Actions for automatic deployment. The workflow is already configured in `.github/workflows/deploy.yml`.

**Setup Instructions:**

1. **Configure GitHub Pages Source:**
   - Go to `https://github.com/ihelfrich/EconGames/settings/pages`
   - Under "Build and deployment", set **Source** to "GitHub Actions"

2. **Set Actions Permissions:**
   - Go to `https://github.com/ihelfrich/EconGames/settings/actions`
   - Under "Workflow permissions", select **"Read and write permissions"**
   - Check **"Allow GitHub Actions to create and approve pull requests"**
   - Click **Save**

3. **Push to main branch:**
   ```bash
   git push
   ```

4. **Your site will be live at:** `https://ihelfrich.github.io/EconGames/`

**Troubleshooting:**

If you get a 404 error during deployment, ensure you've completed step 2 above (Actions permissions).

### Manual Deployment (Alternative)

If you prefer manual deployment:

```bash
npm run build
git add dist -f
git commit -m "Deploy to GitHub Pages"
git subtree push --prefix dist origin gh-pages
```

Then configure GitHub Pages to use the `gh-pages` branch.

## Architecture

### Core Components

- **`src/engine/`**: Economic logic
  - `Agent.ts`: Base agent class, Buyer, and Seller implementations
  - `Market.ts`: Market clearing mechanisms for all market structures

- **`src/game/`**: Visual layer
  - `MainScene.ts`: Phaser scene managing sprite rendering and animations

- **`src/ui/`**: User interface
  - `ChartManager.ts`: Chart.js integration for supply/demand visualization

- **`src/types.ts`**: TypeScript type definitions

### Technology Stack

- **TypeScript**: Type-safe development
- **Vite**: Lightning-fast build tool
- **Phaser 3**: Game engine for sprite management and animations
- **Chart.js**: Real-time chart rendering
- **Modern ES Modules**: Clean, modular code architecture

## Educational Value

This simulator demonstrates:

1. **Market Equilibrium**: How supply and demand intersect to determine price
2. **Price Discovery**: How markets find equilibrium through agent interactions
3. **Market Power**: Effects of monopoly and oligopoly on prices and quantities
4. **Economic Efficiency**: Consumer/producer surplus and deadweight loss
5. **Strategic Behavior**: How firms compete in different market structures

## Customization

### Adjusting Agent Behavior

Edit utility and cost functions in `MainScene.ts`:

```typescript
// Buyer utility function
utilityFunction: (q) => Math.sqrt(q) * 100 - q * 5

// Seller cost function
costFunction: (q) => q * q * 2 + 10 * q
```

### Modifying Market Mechanics

Customize clearing algorithms in `Market.ts` for each market structure.

## Performance

Optimized to handle:
- 200+ agents simultaneously
- 60 FPS animations
- Real-time chart updates
- Smooth sprite movements

## Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari
- Modern mobile browsers

## License

MIT License - Feel free to use for educational purposes

## Credits

**Author**: Dr. Ian Helfrich

Built with inspiration from agent-based economic models and modern game development techniques.

## Contributing

Contributions welcome! This project aims to be a world-class educational tool.

Areas for enhancement:
- Additional market structures (monopsony, bilateral monopoly)
- Government intervention simulations (taxes, subsidies, price controls)
- International trade scenarios
- More sophisticated AI for strategic behavior
- Educational mode with guided tutorials

---

**Live Demo**: [https://ihelfrich.github.io/EconGames/](https://ihelfrich.github.io/EconGames/)
