/**
 * Price History Chart - Track market prices over time
 * @author Dr. Ian Helfrich
 */

import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

export class PriceHistoryChart {
  private chart: Chart | null = null;
  private priceHistory: number[] = [];
  private timeLabels: string[] = [];
  private maxDataPoints: number = 100;
  private startTime: number = Date.now();

  constructor(canvasId: string) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) throw new Error(`Canvas ${canvasId} not found`);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Market Price',
          data: [],
          borderColor: '#f97316',
          backgroundColor: 'rgba(249, 115, 22, 0.15)',
          borderWidth: 2,
          tension: 0.3,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: 'Price History',
            font: { size: 12, weight: 'bold', family: 'Space Grotesk, Segoe UI, sans-serif' }
          }
        },
        scales: {
          x: {
            display: true,
            title: { display: true, text: 'Time', font: { size: 10, family: 'Space Grotesk, Segoe UI, sans-serif' } },
            ticks: { maxTicksLimit: 8, font: { size: 9, family: 'Space Grotesk, Segoe UI, sans-serif' } }
          },
          y: {
            display: true,
            title: { display: true, text: 'Price ($)', font: { size: 10, family: 'Space Grotesk, Segoe UI, sans-serif' } },
            min: 0,
            max: 100,
            ticks: { font: { size: 9, family: 'Space Grotesk, Segoe UI, sans-serif' } }
          }
        }
      }
    });
  }

  addPrice(price: number): void {
    if (!this.chart || price <= 0) return;

    this.priceHistory.push(price);
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    this.timeLabels.push(`${elapsed}s`);

    if (this.priceHistory.length > this.maxDataPoints) {
      this.priceHistory.shift();
      this.timeLabels.shift();
    }

    this.chart.data.labels = this.timeLabels;
    this.chart.data.datasets[0].data = this.priceHistory;
    const maxObserved = Math.max(...this.priceHistory, 10);
    const yMax = Math.max(50, Math.ceil(maxObserved / 10) * 10);
    const scales = this.chart.options.scales as any;
    scales.y.max = yMax;
    this.chart.update('none');
  }

  destroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}
