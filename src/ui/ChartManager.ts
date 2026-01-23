/**
 * Advanced Chart Manager for Supply/Demand Visualization
 * Real-time economic curve rendering derived from actual agent data
 * @author Dr. Ian Helfrich
 */

import { Chart, registerables } from 'chart.js';
import type { Buyer, Seller } from '../engine/Agent';

Chart.register(...registerables);

interface CurvePoint {
  quantity: number;
  price: number;
}

export class ChartManager {
  private chart: Chart | null = null;
  private canvas: HTMLCanvasElement;
  private demandCurve: CurvePoint[] = [];
  private supplyCurve: CurvePoint[] = [];
  private equilibriumPoint: { q: number; p: number } | null = null;

  constructor(canvasId: string) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) {
      throw new Error(`Canvas with id "${canvasId}" not found`);
    }
    this.canvas = canvas;
    this.initializeChart();
  }

  private initializeChart(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Demand',
            data: [],
            borderColor: '#4a90e2',
            backgroundColor: 'rgba(74, 144, 226, 0.15)',
            borderWidth: 3,
            tension: 0.2,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 6,
            order: 2
          },
          {
            label: 'Supply',
            data: [],
            borderColor: '#50c878',
            backgroundColor: 'rgba(80, 200, 120, 0.15)',
            borderWidth: 3,
            tension: 0.2,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 6,
            order: 2
          },
          {
            label: 'Equilibrium',
            data: [],
            borderColor: '#f97316',
            backgroundColor: 'rgba(249, 115, 22, 0.9)',
            borderWidth: 0,
            pointRadius: 8,
            pointHoverRadius: 10,
            pointStyle: 'circle',
            showLine: false,
            order: 1
          },
          {
            label: 'Consumer Surplus',
            data: [],
            borderColor: 'transparent',
            backgroundColor: 'rgba(74, 144, 226, 0.25)',
            fill: true,
            pointRadius: 0,
            order: 3
          },
          {
            label: 'Producer Surplus',
            data: [],
            borderColor: 'transparent',
            backgroundColor: 'rgba(80, 200, 120, 0.25)',
            fill: true,
            pointRadius: 0,
            order: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 300,
          easing: 'easeInOutQuad'
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              font: {
                size: 11,
                family: 'Space Grotesk, Segoe UI, sans-serif',
                weight: 'bold'
              },
              boxWidth: 12,
              padding: 8,
              filter: (item) => {
                // Hide surplus labels from legend
                return !item.text.includes('Surplus');
              }
            }
          },
          title: {
            display: true,
            text: 'Live Supply & Demand',
            font: {
              size: 14,
              weight: 'bold',
              family: 'Space Grotesk, Segoe UI, sans-serif'
            },
            padding: {
              top: 5,
              bottom: 10
            }
          },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || '';
                const value = context.parsed?.y;
                if (value === null || value === undefined) return '';
                if (label === 'Equilibrium') {
                  return `Equilibrium: P=$${value.toFixed(2)}, Q=${context.parsed.x}`;
                }
                return `${label}: $${value.toFixed(2)}`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: 'Quantity',
              font: {
                size: 11,
                weight: 'bold',
                family: 'Space Grotesk, Segoe UI, sans-serif'
              }
            },
            min: 0,
            max: 100,
            grid: {
              color: 'rgba(0, 0, 0, 0.08)',
              lineWidth: 1
            },
            ticks: {
              stepSize: 20,
              font: {
                size: 10,
                family: 'Space Grotesk, Segoe UI, sans-serif'
              }
            }
          },
          y: {
            title: {
              display: true,
              text: 'Price ($)',
              font: {
                size: 11,
                weight: 'bold',
                family: 'Space Grotesk, Segoe UI, sans-serif'
              }
            },
            min: 0,
            max: 120,
            grid: {
              color: 'rgba(0, 0, 0, 0.08)',
              lineWidth: 1
            },
            ticks: {
              font: {
                size: 10,
                family: 'Space Grotesk, Segoe UI, sans-serif'
              }
            }
          }
        },
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false
        }
      }
    });
  }

  /**
   * Build ACTUAL supply and demand curves from agent data
   */
  public updateFromAgents(buyers: Buyer[], sellers: Seller[]): void {
    if (!this.chart) return;

    // Build demand curve from buyers' willingness to pay
    this.demandCurve = this.buildDemandCurve(buyers);

    // Build supply curve from sellers' willingness to accept
    this.supplyCurve = this.buildSupplyCurve(sellers);

    // Find equilibrium
    this.equilibriumPoint = this.findEquilibrium(this.demandCurve, this.supplyCurve);

    // Update chart datasets
    this.chart.data.datasets[0].data = this.demandCurve.map(p => ({ x: p.quantity, y: p.price }));
    this.chart.data.datasets[1].data = this.supplyCurve.map(p => ({ x: p.quantity, y: p.price }));

    // Show equilibrium point
    if (this.equilibriumPoint) {
      this.chart.data.datasets[2].data = [{
        x: this.equilibriumPoint.q,
        y: this.equilibriumPoint.p
      }];

      // Calculate and visualize surpluses
      this.updateSurplusVisualization();
    }

    this.updateScaleRanges();
    this.chart.update('none'); // Update without animation for smoothness
  }

  public getEquilibriumPoint(): { q: number; p: number } | null {
    return this.equilibriumPoint;
  }

  /**
   * Build demand curve: Sort buyers by WTP descending
   */
  private buildDemandCurve(buyers: Buyer[]): CurvePoint[] {
    if (buyers.length === 0) {
      return [{ quantity: 0, price: 100 }];
    }

    // Get all buyers' willingness to pay
    const wtpList = buyers
      .map(b => b.getWillingnessToPay())
      .filter(wtp => wtp > 0)
      .sort((a, b) => b - a); // Descending

    if (wtpList.length === 0) {
      return [{ quantity: 0, price: 100 }];
    }

    // Build step function (each buyer adds 1 unit of demand)
    const curve: CurvePoint[] = [{ quantity: 0, price: wtpList[0] }];

    for (let i = 0; i < wtpList.length; i++) {
      curve.push({ quantity: i + 1, price: wtpList[i] });
    }

    // Add endpoint
    const lastPrice = wtpList[wtpList.length - 1];
    curve.push({ quantity: wtpList.length, price: Math.max(0, lastPrice - 10) });

    return curve;
  }

  /**
   * Build supply curve: Sort sellers by WTA ascending
   */
  private buildSupplyCurve(sellers: Seller[]): CurvePoint[] {
    if (sellers.length === 0) {
      return [{ quantity: 0, price: 10 }];
    }

    // Get all sellers' willingness to accept (marginal cost)
    const wtaList = sellers
      .map(s => s.getWillingnessToPay()) // This is WTA for sellers
      .filter(wta => wta > 0 && wta < 200)
      .sort((a, b) => a - b); // Ascending

    if (wtaList.length === 0) {
      return [{ quantity: 0, price: 10 }];
    }

    // Build step function (each seller adds 1 unit of supply)
    const curve: CurvePoint[] = [{ quantity: 0, price: wtaList[0] }];

    for (let i = 0; i < wtaList.length; i++) {
      curve.push({ quantity: i + 1, price: wtaList[i] });
    }

    return curve;
  }

  /**
   * Find equilibrium where demand = supply
   */
  private findEquilibrium(demand: CurvePoint[], supply: CurvePoint[]): { q: number; p: number } | null {
    if (demand.length < 2 || supply.length < 2) return null;

    // Find intersection point
    for (let q = 0; q < Math.min(demand.length, supply.length); q++) {
      const demandPrice = this.interpolatePrice(demand, q);
      const supplyPrice = this.interpolatePrice(supply, q);

      if (demandPrice !== null && supplyPrice !== null) {
        // Equilibrium: demand price >= supply price
        if (demandPrice >= supplyPrice) {
          const nextQ = q + 1;
          const nextDemandPrice = this.interpolatePrice(demand, nextQ);
          const nextSupplyPrice = this.interpolatePrice(supply, nextQ);

          if (nextDemandPrice !== null && nextSupplyPrice !== null && nextDemandPrice < nextSupplyPrice) {
            // Found equilibrium between q and nextQ
            const eqPrice = (demandPrice + supplyPrice) / 2;
            return { q, p: eqPrice };
          }
        }
      }
    }

    // Fallback: midpoint
    const midQ = Math.floor(Math.min(demand.length, supply.length) / 2);
    const demandP = this.interpolatePrice(demand, midQ);
    const supplyP = this.interpolatePrice(supply, midQ);

    if (demandP !== null && supplyP !== null) {
      return { q: midQ, p: (demandP + supplyP) / 2 };
    }

    return null;
  }

  private interpolatePrice(curve: CurvePoint[], q: number): number | null {
    if (curve.length === 0) return null;
    if (q <= 0) return curve[0].price;
    if (q >= curve[curve.length - 1].quantity) return curve[curve.length - 1].price;

    // Find surrounding points
    for (let i = 0; i < curve.length - 1; i++) {
      if (curve[i].quantity <= q && q <= curve[i + 1].quantity) {
        // Linear interpolation
        const t = (q - curve[i].quantity) / (curve[i + 1].quantity - curve[i].quantity);
        return curve[i].price + t * (curve[i + 1].price - curve[i].price);
      }
    }

    return curve[curve.length - 1].price;
  }

  /**
   * Visualize consumer and producer surplus
   */
  private updateSurplusVisualization(): void {
    if (!this.chart || !this.equilibriumPoint) return;

    const eq = this.equilibriumPoint;

    // Consumer surplus: area between demand and equilibrium price
    const consumerSurplusData: { x: number; y: number }[] = [];
    for (const point of this.demandCurve) {
      if (point.quantity <= eq.q) {
        consumerSurplusData.push({ x: point.quantity, y: Math.max(point.price, eq.p) });
      }
    }

    // Producer surplus: area between equilibrium price and supply
    const producerSurplusData: { x: number; y: number }[] = [];
    for (const point of this.supplyCurve) {
      if (point.quantity <= eq.q) {
        producerSurplusData.push({ x: point.quantity, y: Math.min(point.price, eq.p) });
      }
    }

    this.chart.data.datasets[3].data = consumerSurplusData;
    this.chart.data.datasets[4].data = producerSurplusData;
  }

  private updateScaleRanges(): void {
    if (!this.chart) return;

    const maxDemandPrice = this.demandCurve.reduce((max, point) => Math.max(max, point.price), 0);
    const maxSupplyPrice = this.supplyCurve.reduce((max, point) => Math.max(max, point.price), 0);
    const maxPrice = Math.max(maxDemandPrice, maxSupplyPrice, this.equilibriumPoint?.p ?? 0, 20);
    const maxQuantity = Math.max(this.demandCurve.length, this.supplyCurve.length, 10);

    const xMax = this.roundUpNice(maxQuantity);
    const yMax = this.roundUpNice(maxPrice * 1.2);

    const scales = this.chart.options.scales as any;
    scales.x.max = xMax;
    scales.y.max = yMax;
    scales.x.ticks = { ...scales.x.ticks, stepSize: Math.max(5, Math.round(xMax / 5)) };
  }

  private roundUpNice(value: number): number {
    if (value <= 10) return 10;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const normalized = value / magnitude;
    let nice = 1;
    if (normalized <= 1.5) {
      nice = 1.5;
    } else if (normalized <= 2) {
      nice = 2;
    } else if (normalized <= 3) {
      nice = 3;
    } else if (normalized <= 5) {
      nice = 5;
    } else {
      nice = 10;
    }
    return Math.ceil(nice * magnitude);
  }

  public destroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}
