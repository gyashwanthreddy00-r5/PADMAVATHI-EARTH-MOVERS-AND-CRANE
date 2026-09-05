import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, Legend,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#64748b'];

export function FleetDonutChart({ data }: { data: { name: string; value: number; color?: string }[] }) {
  const nonZero = data.filter(d => d.value > 0);
  if (nonZero.length === 0) {
    return <div className="flex items-center justify-center h-[200px] text-sm text-slate-400">No fleet data</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={nonZero}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
          dataKey="value"
        >
          {nonZero.map((entry, i) => (
            <Cell key={i} fill={entry.color ?? PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: number) => [`${v} vehicles`, '']}
          contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function RevenueBarChart({ data, height = 260 }: { data: { label: string; revenue: number; expenses: number }[]; height?: number }) {
  if (data.length === 0) {
    return <div className="flex items-center justify-center h-[260px] text-sm text-slate-400">No revenue data</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} />
        <Tooltip
          formatter={(v: number, name: string) => [formatCurrency(v), name === 'revenue' ? 'Revenue' : 'Expenses']}
          contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
        />
        <Legend wrapperStyle={{ fontSize: '12px' }} formatter={(v) => v === 'revenue' ? 'Revenue' : 'Expenses'} />
        <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
        <Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RentalsTrendChart({ data, height = 220 }: { data: { label: string; rentals: number }[]; height?: number }) {
  if (data.length === 0) {
    return <div className="flex items-center justify-center h-[220px] text-sm text-slate-400">No rental data</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
        <Line type="monotone" dataKey="rentals" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CraneTypeBarChart({ data, height = 220 }: { data: { label: string; count: number }[]; height?: number }) {
  if (data.length === 0) {
    return <div className="flex items-center justify-center h-[220px] text-sm text-slate-400">No data</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} width={100} />
        <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
        <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}
