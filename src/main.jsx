import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Papa from 'papaparse';
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  FileSpreadsheet,
  Hash,
  LineChart,
  Loader2,
  PieChart,
  Search,
  Table2,
  Text,
  Upload,
} from 'lucide-react';
import {
  Bar,
  Bubble,
  Doughnut,
  Line,
  Pie,
  PolarArea,
  Radar,
  Scatter,
} from 'react-chartjs-2';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  RadialLinearScale,
  TimeScale,
  Title,
  Tooltip,
  ArcElement,
} from 'chart.js';
import './styles.css';

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  RadialLinearScale,
  TimeScale,
  Title,
  Tooltip,
);

const MAX_ROWS = 5000;
const CHART_TARGET = 40;
const palette = [
  '#2563eb',
  '#0891b2',
  '#16a34a',
  '#ca8a04',
  '#dc2626',
  '#7c3aed',
  '#db2777',
  '#475569',
  '#0f766e',
  '#ea580c',
  '#4f46e5',
  '#65a30d',
];

const sampleCsv = `Order Date,Region,Category,Product,Sales,Profit,Quantity,Customer Segment
2026-01-05,North,Technology,Laptop,1299.99,214.35,2,Enterprise
2026-01-12,West,Furniture,Desk,399.50,51.25,1,Small Business
2026-02-03,South,Office Supplies,Paper,45.20,9.80,12,Consumer
2026-02-20,East,Technology,Monitor,249.99,44.90,3,Consumer
2026-03-15,North,Furniture,Chair,159.95,22.40,4,Enterprise
2026-03-28,West,Technology,Tablet,499.00,82.15,2,Small Business
2026-04-09,South,Office Supplies,Ink,89.99,18.70,5,Consumer
2026-04-22,East,Furniture,Shelf,219.00,35.00,1,Enterprise
2026-05-06,North,Technology,Phone,799.00,132.00,3,Consumer
2026-05-17,West,Office Supplies,Notebook,24.75,6.10,20,Small Business`;

function parseNumeric(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim().replace(/[$,%\s,]/g, '');
  if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'null') return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function parseDate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || /^\d+(\.\d+)?$/.test(text)) return null;
  const time = Date.parse(text);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return date.getFullYear() >= 1900 && date.getFullYear() <= 2200 ? date : null;
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function headerHint(name) {
  const n = name.toLowerCase();
  if (/(date|day|month|year|time|created|updated|period)/.test(n)) return 'date';
  if (/(id|code|zip|postal|phone|sku)/.test(n)) return 'common_text';
  if (/(amount|sales|revenue|profit|price|cost|qty|quantity|count|rate|score|total|value|age|number|num)/.test(n)) return 'number';
  if (/(name|category|region|segment|type|status|city|state|country|product)/.test(n)) return 'common_text';
  return 'text';
}

function inferType(header, values) {
  const nonEmpty = values.filter((v) => String(v ?? '').trim() !== '');
  if (!nonEmpty.length) return 'empty';
  const numericCount = nonEmpty.filter((v) => parseNumeric(v) !== null).length;
  const dateCount = nonEmpty.filter((v) => parseDate(v) !== null).length;
  const uniqueCount = new Set(nonEmpty.map((v) => String(v).trim())).size;
  const uniqueRatio = uniqueCount / nonEmpty.length;
  const hint = headerHint(header);

  if (hint === 'date' && dateCount / nonEmpty.length >= 0.55) return 'date';
  if (dateCount / nonEmpty.length >= 0.75) return 'date';
  if (hint === 'number' && numericCount / nonEmpty.length >= 0.6) return 'number';
  if (numericCount / nonEmpty.length >= 0.85 && uniqueRatio > 0.03) return 'number';
  if (uniqueCount <= Math.max(25, Math.sqrt(nonEmpty.length) * 2) || uniqueRatio <= 0.25) return 'common_text';
  return 'text';
}

function summarizeColumn(name, values) {
  const type = inferType(name, values);
  const nonEmpty = values.filter((v) => String(v ?? '').trim() !== '');
  const missing = values.length - nonEmpty.length;
  const unique = new Set(nonEmpty.map((v) => String(v).trim())).size;
  const base = { name, type, missing, unique, count: values.length, sample: nonEmpty.slice(0, 4) };

  if (type === 'number') {
    const nums = values.map(parseNumeric).filter((v) => v !== null);
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = nums.length ? sum / nums.length : 0;
    const variance = nums.length ? nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length : 0;
    return {
      ...base,
      min: Math.min(...nums),
      max: Math.max(...nums),
      sum,
      mean,
      median: quantile(nums, 0.5),
      q1: quantile(nums, 0.25),
      q3: quantile(nums, 0.75),
      stdev: Math.sqrt(variance),
      values: nums,
    };
  }

  if (type === 'date') {
    const dates = values.map(parseDate).filter(Boolean).sort((a, b) => a - b);
    return { ...base, minDate: dates[0], maxDate: dates[dates.length - 1], dates };
  }

  const counts = countBy(values);
  return { ...base, counts };
}

function countBy(values) {
  const counts = new Map();
  values.forEach((value) => {
    const label = String(value ?? '').trim() || '(blank)';
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function groupMetric(rows, labelCol, metricCol, op = 'sum', limit = 12) {
  const groups = new Map();
  rows.forEach((row) => {
    const label = String(row[labelCol] ?? '').trim() || '(blank)';
    const value = parseNumeric(row[metricCol]);
    if (value === null) return;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(value);
  });
  return [...groups.entries()]
    .map(([label, values]) => {
      const sum = values.reduce((a, b) => a + b, 0);
      const value = op === 'avg' ? sum / values.length : op === 'count' ? values.length : sum;
      return { label, value };
    })
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit);
}

function timeSeries(rows, dateCol, metricCol, bucket = 'month') {
  const groups = new Map();
  rows.forEach((row) => {
    const date = parseDate(row[dateCol]);
    const value = parseNumeric(row[metricCol]);
    if (!date || value === null) return;
    const label = bucket === 'year'
      ? `${date.getFullYear()}`
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    groups.set(label, (groups.get(label) || 0) + value);
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));
}

function histogram(values, bins = 10) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return [];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return [{ label: `${formatNumber(min)}`, value: nums.length }];
  const width = (max - min) / bins;
  const buckets = Array.from({ length: bins }, (_, i) => ({
    label: `${formatNumber(min + i * width)}-${formatNumber(min + (i + 1) * width)}`,
    value: 0,
  }));
  nums.forEach((value) => {
    const index = Math.min(bins - 1, Math.floor((value - min) / width));
    buckets[index].value += 1;
  });
  return buckets;
}

function correlation(rows, aCol, bCol) {
  const pairs = rows
    .map((row) => [parseNumeric(row[aCol]), parseNumeric(row[bCol])])
    .filter(([a, b]) => a !== null && b !== null);
  if (pairs.length < 3) return null;
  const meanA = pairs.reduce((s, [a]) => s + a, 0) / pairs.length;
  const meanB = pairs.reduce((s, [, b]) => s + b, 0) / pairs.length;
  const top = pairs.reduce((s, [a, b]) => s + (a - meanA) * (b - meanB), 0);
  const botA = Math.sqrt(pairs.reduce((s, [a]) => s + (a - meanA) ** 2, 0));
  const botB = Math.sqrt(pairs.reduce((s, [, b]) => s + (b - meanB) ** 2, 0));
  return botA && botB ? top / (botA * botB) : null;
}

function chartData(points, kind = 'single') {
  const labels = points.map((p) => p.label);
  if (kind === 'multi') return points;
  return {
    labels,
    datasets: [{
      label: 'Value',
      data: points.map((p) => p.value),
      backgroundColor: labels.map((_, index) => palette[index % palette.length]),
      borderColor: labels.map((_, index) => palette[index % palette.length]),
      borderWidth: 2,
      fill: false,
      tension: 0.35,
    }],
  };
}

function buildChartOptions(title, horizontal = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { ticks: { maxRotation: 0, autoSkip: true }, grid: { color: '#edf2f7' } },
      y: { beginAtZero: true, grid: { color: '#edf2f7' } },
    },
  };
}

function analyzeRows(rows, fields) {
  const columns = fields.map((field) => summarizeColumn(field, rows.map((row) => row[field])));
  const numbers = columns.filter((c) => c.type === 'number');
  const categories = columns.filter((c) => c.type === 'common_text');
  const text = columns.filter((c) => c.type === 'text');
  const dates = columns.filter((c) => c.type === 'date');
  const charts = [];

  categories.forEach((category) => {
    charts.push({
      key: `count-${category.name}`,
      title: `Records by ${category.name}`,
      subtitle: 'Frequency distribution',
      type: 'bar',
      score: 84 - Math.min(category.unique, 30),
      icon: BarChart3,
      data: chartData(category.counts.slice(0, 12).map(([label, value]) => ({ label, value }))),
      options: buildChartOptions(),
    });
    if (category.unique <= 12) {
      charts.push({
        key: `share-${category.name}`,
        title: `${category.name} share`,
        subtitle: 'Part-to-whole breakdown',
        type: 'doughnut',
        score: 78 - category.unique,
        icon: PieChart,
        data: chartData(category.counts.slice(0, 10).map(([label, value]) => ({ label, value }))),
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }
  });

  numbers.forEach((metric) => {
    charts.push({
      key: `hist-${metric.name}`,
      title: `${metric.name} distribution`,
      subtitle: 'Histogram with equal-width bins',
      type: 'bar',
      score: 74,
      icon: BarChart3,
      data: chartData(histogram(metric.values)),
      options: buildChartOptions(),
    });
    categories.slice(0, 5).forEach((category) => {
      ['sum', 'avg'].forEach((op) => {
        const points = groupMetric(rows, category.name, metric.name, op);
        if (points.length > 1) {
          charts.push({
            key: `${op}-${metric.name}-by-${category.name}`,
            title: `${op === 'sum' ? 'Total' : 'Average'} ${metric.name} by ${category.name}`,
            subtitle: `${op === 'sum' ? 'Sum' : 'Mean'} grouped by category`,
            type: points.length > 8 ? 'bar-horizontal' : 'bar',
            score: 92 - points.length + (op === 'sum' ? 4 : 0),
            icon: BarChart3,
            data: chartData(points),
            options: buildChartOptions('', points.length > 8),
          });
        }
      });
    });
    dates.forEach((dateCol) => {
      const points = timeSeries(rows, dateCol.name, metric.name);
      if (points.length > 1) {
        charts.push({
          key: `trend-${metric.name}-by-${dateCol.name}`,
          title: `${metric.name} trend by ${dateCol.name}`,
          subtitle: 'Time-series sum by month',
          type: 'line',
          score: 96 + Math.min(points.length, 10),
          icon: LineChart,
          data: chartData(points),
          options: buildChartOptions(),
        });
      }
    });
  });

  for (let i = 0; i < numbers.length; i += 1) {
    for (let j = i + 1; j < numbers.length; j += 1) {
      const a = numbers[i];
      const b = numbers[j];
      const corr = correlation(rows, a.name, b.name);
      const points = rows
        .map((row) => ({ x: parseNumeric(row[a.name]), y: parseNumeric(row[b.name]) }))
        .filter((p) => p.x !== null && p.y !== null)
        .slice(0, 400);
      if (points.length > 3) {
        charts.push({
          key: `scatter-${a.name}-${b.name}`,
          title: `${a.name} vs ${b.name}`,
          subtitle: corr === null ? 'Numeric relationship' : `Correlation ${corr.toFixed(2)}`,
          type: 'scatter',
          score: 82 + Math.abs(corr || 0) * 20,
          icon: LineChart,
          data: {
            datasets: [{
              label: `${a.name} vs ${b.name}`,
              data: points,
              backgroundColor: '#2563eb99',
            }],
          },
          options: buildChartOptions(),
        });
      }
    }
  }

  while (charts.length < Math.min(CHART_TARGET, Math.max(8, fields.length * 5)) && numbers.length && categories.length) {
    const category = categories[charts.length % categories.length];
    const metric = numbers[charts.length % numbers.length];
    const points = groupMetric(rows, category.name, metric.name, charts.length % 2 ? 'sum' : 'avg', 8);
    if (!points.length) break;
    charts.push({
      key: `alt-${charts.length}-${category.name}-${metric.name}`,
      title: `${metric.name} spotlight across ${category.name}`,
      subtitle: 'Additional recommended view',
      type: charts.length % 3 === 0 ? 'polar' : charts.length % 3 === 1 ? 'radar' : 'bar',
      score: 60 - charts.length / 10,
      icon: PieChart,
      data: chartData(points),
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { r: { beginAtZero: true } } },
    });
  }

  return {
    rows,
    fields,
    columns,
    numbers,
    categories,
    text,
    dates,
    charts: charts
      .sort((a, b) => b.score - a.score)
      .slice(0, CHART_TARGET),
  };
}

function parseCsv(text, fileName = 'sample.csv') {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (header) => header.trim(),
  });
  if (result.errors?.length) {
    const fatal = result.errors.find((error) => error.type === 'Delimiter' || error.code === 'TooFewFields');
    if (fatal) throw new Error(fatal.message);
  }
  const fields = result.meta.fields?.filter(Boolean) || [];
  const rows = result.data
    .filter((row) => fields.some((field) => String(row[field] ?? '').trim() !== ''))
    .slice(0, MAX_ROWS);
  if (!fields.length || !rows.length) throw new Error('The CSV needs a header row and at least one data row.');
  return { ...analyzeRows(rows, fields), fileName, totalRows: result.data.length };
}

function ChartRenderer({ chart }) {
  const props = { data: chart.data, options: chart.options };
  if (chart.type === 'line') return <Line {...props} />;
  if (chart.type === 'scatter') return <Scatter {...props} />;
  if (chart.type === 'doughnut') return <Doughnut {...props} />;
  if (chart.type === 'pie') return <Pie {...props} />;
  if (chart.type === 'polar') return <PolarArea {...props} />;
  if (chart.type === 'radar') return <Radar {...props} />;
  if (chart.type === 'bubble') return <Bubble {...props} />;
  return <Bar {...props} />;
}

function TypeIcon({ type }) {
  if (type === 'number') return <Hash size={16} />;
  if (type === 'date') return <CalendarDays size={16} />;
  if (type === 'common_text') return <Table2 size={16} />;
  return <Text size={16} />;
}

function App() {
  const [analysis, setAnalysis] = useState(() => parseCsv(sampleCsv, 'sample-sales.csv'));
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(30);
  const [isParsing, setIsParsing] = useState(false);

  const filteredCharts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return analysis.charts.filter((chart) => !q || chart.title.toLowerCase().includes(q) || chart.subtitle.toLowerCase().includes(q));
  }, [analysis, query]);

  function loadFile(file) {
    if (!file) return;
    setError('');
    setIsParsing(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setAnalysis(parseCsv(String(reader.result), file.name));
        setVisibleCount(30);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsParsing(false);
      }
    };
    reader.onerror = () => {
      setError('Could not read this file.');
      setIsParsing(false);
    };
    reader.readAsText(file);
  }

  const quality = analysis.columns.filter((col) => col.missing === 0).length / analysis.columns.length;

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <span className="eyebrow">CSV Insight Dashboard</span>
          <h1>Analyze any CSV and auto-build the right dashboard.</h1>
        </div>
        <label className="upload-button">
          {isParsing ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
          <span>Upload CSV</span>
          <input type="file" accept=".csv,text/csv" onChange={(event) => loadFile(event.target.files?.[0])} />
        </label>
      </section>

      {error && (
        <div className="alert">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      <section className="summary-grid">
        <div className="metric-panel wide">
          <FileSpreadsheet size={22} />
          <div>
            <p>Loaded file</p>
            <strong>{analysis.fileName}</strong>
          </div>
        </div>
        <div className="metric-panel">
          <p>Rows analyzed</p>
          <strong>{formatNumber(analysis.rows.length)}</strong>
        </div>
        <div className="metric-panel">
          <p>Columns</p>
          <strong>{analysis.fields.length}</strong>
        </div>
        <div className="metric-panel">
          <p>Auto charts</p>
          <strong>{analysis.charts.length}</strong>
        </div>
        <div className="metric-panel">
          <p>Complete columns</p>
          <strong>{Math.round(quality * 100)}%</strong>
        </div>
      </section>

      <section className="workspace">
        <aside className="side-panel">
          <div className="panel-header">
            <h2>Column intelligence</h2>
            <span>{analysis.columns.length} fields</span>
          </div>
          <div className="column-list">
            {analysis.columns.map((column) => (
              <article className="column-card" key={column.name}>
                <div className="column-title">
                  <TypeIcon type={column.type} />
                  <strong>{column.name}</strong>
                </div>
                <span className={`type-pill ${column.type}`}>{column.type.replace('_', ' ')}</span>
                <dl>
                  <div><dt>Unique</dt><dd>{column.unique}</dd></div>
                  <div><dt>Missing</dt><dd>{column.missing}</dd></div>
                  {column.type === 'number' && <div><dt>Mean</dt><dd>{formatNumber(column.mean)}</dd></div>}
                  {column.type === 'date' && <div><dt>Range</dt><dd>{column.minDate?.toLocaleDateString()} - {column.maxDate?.toLocaleDateString()}</dd></div>}
                </dl>
              </article>
            ))}
          </div>
        </aside>

        <section className="dashboard">
          <div className="dashboard-toolbar">
            <div>
              <h2>Recommended graphs</h2>
              <p>Ranked from the inferred column types, cardinality, time fields, and numeric relationships.</p>
            </div>
            <div className="searchbox">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search charts" />
            </div>
          </div>

          <div className="chart-grid">
            {filteredCharts.slice(0, visibleCount).map((chart) => {
              const Icon = chart.icon;
              return (
                <article className="chart-card" key={chart.key}>
                  <header>
                    <div>
                      <Icon size={18} />
                      <h3>{chart.title}</h3>
                    </div>
                    <span><Check size={14} /> {Math.round(chart.score)}</span>
                  </header>
                  <p>{chart.subtitle}</p>
                  <div className="chart-box">
                    <ChartRenderer chart={chart} />
                  </div>
                </article>
              );
            })}
          </div>

          {visibleCount < filteredCharts.length && (
            <button className="load-more" onClick={() => setVisibleCount((count) => count + 10)}>
              <ChevronDown size={18} />
              Show more graphs
            </button>
          )}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
