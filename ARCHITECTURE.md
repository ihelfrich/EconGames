# EconGames Architecture

## Overview

EconGames is built with a clean separation between economic logic, game rendering, and user interface. This architecture ensures maintainability, testability, and extensibility.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User Interface                        │
│  (HTML/CSS + UI Controls + Chart.js Visualization)          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                     Game Layer (Phaser 3)                    │
│  • MainScene: Sprite rendering and animations               │
│  • Visual effects: Particles, lines, text                   │
│  • Event handling: User interactions                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Economic Engine (Pure Logic)               │
│  • Market: Clearing mechanisms                              │
│  • Agent: Buyer and Seller behavior                         │
│  • Economic calculations: Surplus, DWL, etc.                │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Economic Engine (`src/engine/`)

#### Agent.ts
- **Abstract Agent Class**: Base class for all economic actors
  - Properties: id, type, reservationPrice, position, velocity
  - Methods: `canTrade()`, `executeTradeAt()`, `getSurplusFrom()`

- **Buyer Class**: Consumers with utility functions
  - Budget constraints
  - Diminishing marginal utility
  - Willingness to pay calculation

- **Seller Class**: Producers with cost functions
  - Inventory management
  - Increasing marginal costs
  - Minimum acceptable price

#### Market.ts
- **Market Clearing**: Matches buyers with sellers
- **Market Structures**:
  - Perfect Competition: Price-taking, equilibrium clearing
  - Monopoly: Single seller, MR = MC pricing
  - Oligopoly: Strategic pricing with few sellers
  - Monopolistic Competition: Differentiated products

- **State Management**: Tracks transactions, prices, surpluses

### 2. Game Layer (`src/game/`)

#### MainScene.ts
- **Sprite Management**:
  - Buyers: Blue circles with cute faces
  - Sellers: Green squares with cute faces
  - Dynamic spawning/despawning

- **Animation System**:
  - Smooth movement with velocity vectors
  - Wall bouncing physics
  - Pulse effects on trade
  - Particle effects for transactions

- **Performance**:
  - Efficient sprite pooling
  - 60 FPS target
  - Handles 200+ agents smoothly

### 3. UI Layer (`src/ui/`)

#### ChartManager.ts
- **Real-time Visualization**:
  - Supply curve (upward sloping)
  - Demand curve (downward sloping)
  - Equilibrium point highlighting

- **Dynamic Updates**:
  - Market mode adjustments
  - Smooth transitions
  - Responsive to state changes

### 4. Main Entry (`src/main.ts`)

- Initializes Phaser game
- Sets up market instance
- Connects UI controls
- Manages application lifecycle

## Data Flow

### Trade Execution Flow

```
1. User adjusts controls (slider, mode button)
   ↓
2. MainScene updates target counts or market mode
   ↓
3. Agents spawn/despawn to match targets
   ↓
4. Market.clearMarket() runs periodically
   ↓
5. Market matches buyers/sellers based on mode
   ↓
6. Trades execute, updating agent state
   ↓
7. MainScene visualizes trades (lines, particles, text)
   ↓
8. UI updates stats (price, surplus, transactions)
   ↓
9. ChartManager updates supply/demand curves
```

## Economic Models

### Perfect Competition
- **Theory**: Many buyers and sellers, homogeneous product
- **Implementation**:
  - Sort buyers by WTP (descending)
  - Sort sellers by WTA (ascending)
  - Clear at equilibrium where supply = demand
- **Result**: Efficient allocation, maximum total surplus

### Monopoly
- **Theory**: Single seller with market power
- **Implementation**:
  - Single seller restricts quantity
  - Sets price above marginal cost
  - Only trades with high-WTP buyers
- **Result**: Higher prices, lower quantity, deadweight loss

### Oligopoly
- **Theory**: Few sellers, strategic interaction
- **Implementation**:
  - 3-4 sellers coordinate implicitly
  - Price above competitive but below monopoly
  - Cournot-like quantity competition
- **Result**: Moderate inefficiency

### Monopolistic Competition
- **Theory**: Many sellers, differentiated products
- **Implementation**:
  - Each seller has slight pricing power
  - Random "brand preferences" for buyers
  - Price variation across sellers
- **Result**: Near-efficient with product variety

## Key Design Decisions

### 1. Separation of Concerns
- Economic logic is **pure TypeScript** (no Phaser dependencies)
- Can be tested independently
- Could be reused in other contexts (CLI, web workers, etc.)

### 2. Agent-Based Modeling
- Emergent behavior from individual rules
- More realistic than aggregate models
- Visually compelling

### 3. Real-time Updates
- Market clears every second (adjustable)
- Sprites update every 50ms
- Charts update every 500ms
- Balanced for performance and responsiveness

### 4. Type Safety
- Strict TypeScript configuration
- Comprehensive type definitions
- Catches errors at compile time

## Extension Points

### Adding New Market Structures
1. Add mode to `MarketMode` type in `types.ts`
2. Implement clearing logic in `Market.ts`
3. Add UI button in `index.html`
4. Update chart adjustments in `ChartManager.ts`

### Customizing Agent Behavior
- Modify utility/cost functions in agent constructors
- Add new learning algorithms in `Agent.updateReservationPrice()`
- Implement strategic behavior (collusion, price wars)

### Adding Government Interventions
- Price ceilings/floors: Modify `Market.applyPriceControls()`
- Taxes/subsidies: Adjust prices in trade execution
- Quotas: Limit quantity in clearing mechanisms

### Educational Features
- Tutorial overlays explaining concepts
- Step-by-step mode with explanations
- Quiz integration
- Scenario challenges

## Performance Considerations

### Bottlenecks
1. **Sprite rendering**: Mitigated by using Graphics objects instead of individual sprites
2. **Market clearing**: O(n log n) sorting, efficient for 200 agents
3. **Chart updates**: Throttled to 500ms intervals

### Optimization Techniques
- Lazy sprite creation/destruction
- Object pooling for particles
- Efficient collision detection (wall bouncing only)
- Minimal DOM updates

## Testing Strategy

### Unit Tests (Recommended)
- `Agent` utility/cost calculations
- `Market` clearing logic for each mode
- Surplus calculations
- Price control enforcement

### Integration Tests
- Full market simulation cycles
- Agent lifecycle management
- State consistency

### Visual Testing
- Sprite rendering correctness
- Animation smoothness
- UI responsiveness

## Future Enhancements

1. **Economic Features**:
   - Monopsony (single buyer)
   - Bilateral monopoly
   - International trade
   - Factor markets

2. **Educational Features**:
   - Interactive tutorials
   - Scenario library
   - Student challenges
   - Data export for analysis

3. **Technical Features**:
   - WebGL rendering for more agents
   - Service worker for offline use
   - Multiplayer mode
   - Historical playback

---

**Designed by Dr. Ian Helfrich**

Built with rigorous economic theory and modern software engineering practices.
