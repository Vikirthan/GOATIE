import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeft, ChevronDown, ChevronUp, Download, Info, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useAnalyticsData } from '@/hooks/useAnalyticsData';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { HerdSwitcher } from '@/components/common/HerdSwitcher';
import {
  computeFinancials,
  computeGrowth,
  computeHealth,
  computeHerd,
  computeReadyToSell,
  distinctVariants,
  filterGoats,
} from '@/utils/analytics';
import { formatCurrency } from '@/utils/helpers';

type Tab = 'profit' | 'growth' | 'health' | 'herd';

const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16'];

type GuideLanguage = 'en' | 'ta';
type LocalizedGuideText = Record<GuideLanguage, string>;
type ReadyDisplayRow = {
  earTag: string;
  lastWeight: number;
  daysOnFarm: number;
  reason: string;
  projectedAmount: number;
  projectedProfit: number;
};

const tr = (language: GuideLanguage, en: string, ta: string) => language === 'en' ? en : ta;
type GuideItem = { id: string; label: LocalizedGuideText; meaning: LocalizedGuideText };

const TAB_GUIDES: Record<Tab, GuideItem[]> = {
  profit: [
    { id: 'totalInvestment', label: { en: 'Total investment', ta: 'மொத்த முதலீடு' }, meaning: { en: 'Purchase cost of every goat in the current filter, including active, sold and deceased goats.', ta: 'தற்போதைய வடிகட்டலில் உள்ள ஒவ்வொரு ஆடும் (இன்னும் உள்ளவை, விற்கப்பட்டவை, இறந்தவை உள்ளிட்ட) வாங்கிய செலவும்.' } },
    { id: 'totalRevenue', label: { en: 'Total revenue', ta: 'மொத்த வருவாய்' }, meaning: { en: 'Money received from completed sales before commission, transport and other sale charges.', ta: 'கமிஷன், ஓச்சார், பிற விற்பனைச் செலவுகளுக்கு முன், முடிந்த விற்பனைகளிலிருந்து கிடைத்த பணம்.' } },
    { id: 'totalProfit', label: { en: 'Total profit & ROI', ta: 'மொத்த லாபம் & ROI' }, meaning: { en: 'Profit after purchase and sale costs; ROI is that profit divided by the purchase cost of sold goats.', ta: 'வாங்கும் செலவும் விற்பனைச் செலவுகளும் கழித்த பின் மிளைந்த லாபம்; ROI என்பது அந்த லாபத்தை விற்கப்பட்ட ஆடுகளின் வாங்கும் செலவால் பிரித்தது.' } },
    { id: 'averageProfit', label: { en: 'Average profit', ta: 'சராசரி லாபம்' }, meaning: { en: 'Net profit divided by the number of goats sold.', ta: 'நிகர லாபத்தை விற்கப்பட்ட ஆடுகளின் எண்ணிக்கையால் பிரித்தது.' } },
    { id: 'averageRate', label: { en: 'Average sale rate', ta: 'சராசரி விற்பனை விலை' }, meaning: { en: 'Average completed-sale price per kg.', ta: 'முடிந்த விற்பனைகளில் கிலோவுக்கான சராசரி விலை.' } },
    { id: 'activeHerdValue', label: { en: 'Active herd value', ta: 'இன்னும் உள்ள ஆடுகளின் மதிப்பு' }, meaning: { en: 'Purchase cost of active goats and their estimated sale value using recent sale rates.', ta: 'இன்னும் உள்ள ஆடுகளின் வாங்கும் செலவும், சமீபத்திய விற்பனை விலைகளைப் பயன்படுத்தி கணக்கிடப்பட்ட அவற்றின் மதிப்பும்.' } },
    { id: 'revenueProfit', label: { en: 'Revenue vs profit', ta: 'வருவாயும் லாபமும்' }, meaning: { en: 'Monthly sale amount compared with the profit left after purchase and sale costs.', ta: 'மாதாந்திர விற்பனைத் தொகை, வாங்கும் மற்றும் விற்பனைச் செலவுகள் கழித்து மீதமுள்ள லாபத்துடன் ஒப்பிடுதல்.' } },
    { id: 'monthlySales', label: { en: 'Monthly sales trend', ta: 'மாத விற்பனைப் போக்கு' }, meaning: { en: 'Number of goats sold in each of the last 6 calendar months, grouped by sale date.', ta: 'விற்பனைத் தேதி வாரியாகக் கடந்த 6 மாதங்களில் ஒவ்வொரு மாதத்திலும் விற்கப்பட்ட ஆடுகளின் எண்ணிக்கை.' } },
    { id: 'variantProfit', label: { en: 'Profit by variant', ta: 'இனம் வாரியாக லாபம்' }, meaning: { en: 'Net profit grouped by breed; higher profit means the breed performed better.', ta: 'இனம் வாரியாகத் தொகுக்கப்பட்ட நிகர லாபம்; லாபம் அதிகம் என்பது அந்த இனம் சிறப்பாகச் செயல்பட்டது.' } },
    { id: 'deductions', label: { en: 'Deductions', ta: 'குறைப்புச் செலவுகள்' }, meaning: { en: 'Commission, transport and other charges subtracted from sales.', ta: 'விற்பனையிலிருந்து கழிக்கப்படும் கமிஷன், ஓச்சார் மற்றும் பிற செலவுகள்.' } },
    { id: 'buyers', label: { en: 'Top buyers', ta: 'சிறந்த வாங்கியர்கள்' }, meaning: { en: 'Buyers ranked by total sales revenue.', ta: 'மொத்த விற்பனை வருவாயின் அடிப்படையில் வரிசைப்படுத்தப்பட்ட வாங்கியர்கள்.' } },
  ],
  growth: [
    { id: 'averageWeeklyGrowth', label: { en: 'Average weekly growth', ta: 'சராசரி வாராந்திர வளர்ச்சி' }, meaning: { en: 'Average kg gained per week: total weight gain divided by days on farm, multiplied by 7.', ta: 'ஒரு வாரத்துக்குச் சராசரியாகக் கூடிய கிலோ: மொத்த நிறைச் சேர்க்கையை விளையில் இருந்த நாட்களால் பிரித்து 7ஆல் பெருக்க வேண்டும்.' } },
    { id: 'averageGain', label: { en: 'Average gain', ta: 'சராசரி நிறை சேர்க்கை' }, meaning: { en: 'Average kg added between purchase weight and the latest recorded weight.', ta: 'வாங்கியபோதைய நிறையிலிருந்து கடைசியாகப் பதிவான நிறைக்கு இடையில் சராசரியாகக் கூடிய கிலோக்கள்.' } },
    { id: 'holdingPeriod', label: { en: 'Average holding period', ta: 'சராசரி வளர்ப்புக் காலம்' }, meaning: { en: 'Average number of days sold goats stayed on the farm.', ta: 'விற்கப்பட்ட ஆடுகள் விளையில் இருந்தத சராசரி நாட்கள்.' } },
    { id: 'growthCurve', label: { en: 'Herd growth curve', ta: 'ஆடுகளின் வளர்ச்சி வளைவு' }, meaning: { en: 'Average weight at purchase, monthly weight checks W1-W4 and sale.', ta: 'வாங்கியபோதைய சராசரி நிறை, மாத விளை நேரங்கள் W1–W4 சராசரி நிறை, விற்பனை நேரத்தில் எடைந்த சராசரி நிறை.' } },
    { id: 'gainDistribution', label: { en: 'Monthly gain distribution', ta: 'மாத வளர்ச்சி பங்கீடு' }, meaning: { en: 'How many goats gained less than 0, 0-1.5, 1.5-3 or 3+ kg per month.', ta: 'மாதத்துக்கு 0-க்குக் குறைவாக, 0–1.5, 1.5–3 அல்லது 3+ கிலோ கூடிய ஆடுகள் எத்தனை என்பதன் வரிசை.' } },
    { id: 'variantComparison', label: { en: 'Variant comparison', ta: 'இன ஒப்பீடு' }, meaning: { en: 'Average weekly gain and total gain for each breed.', ta: 'ஒவ்வொரு இனத்திற்கும் சராசரி வாராந்திர வளர்ச்சியும் மொத்த நிறை சேர்க்கையும்.' } },
    { id: 'topGrowers', label: { en: 'Top growers', ta: 'சிறந்த வளர்ச்சி ஆடுகள்' }, meaning: { en: 'The five goats with the highest average weekly gain.', ta: 'சராசரி வாராந்திர வளர்ச்சி அதிகமான ஐந்து ஆடுகள்.' } },
    { id: 'needsAttention', label: { en: 'Needs attention', ta: 'கவனம் தேவை' }, meaning: { en: 'Active goats on the farm for 30+ days and gaining less than 1.5 kg per month.', ta: '30-க்கு மேல் நாட்களாக விளையில் இருந்தாலும், மாதத்துக்கு 1.5 கிலோக்குக் குறைவாக வளரும் செயலுள்ள ஆடுகள்.' } },
  ],
  health: [
    { id: 'vaccinationCoverage', label: { en: 'Vaccination coverage', ta: 'தடுப்பூசி பாதுகாப்பு' }, meaning: { en: 'Share of active goats that have a vaccination record.', ta: 'தடுப்பூசி பதிவு உள்ள செயலுள்ள ஆடுகளின் பகுதி.' } },
    { id: 'dewormingCoverage', label: { en: 'Deworming coverage', ta: 'முற்பை நீக்கல் பாதுகாப்பு' }, meaning: { en: 'Share of active goats that have a deworming record.', ta: 'முற்பை நீக்கல் பதிவு உள்ள செயலுள்ள ஆடுகளின் பகுதி.' } },
    { id: 'weightCompliance', label: { en: 'Weight compliance', ta: 'எடைப் பதிவுப் பூர்த்தி' }, meaning: { en: 'Share of due weight checks that have been recorded.', ta: 'நேரம் வந்த எடைப் பதிவுகளில், பதிவு செய்யப்பட்டவற்றின் பகுதி.' } },
    { id: 'healthWeightDue', label: { en: 'Weight due', ta: 'நேரம் வந்த எடைப் பதிவு' }, meaning: { en: 'Weight checks whose due date has arrived but have not been recorded.', ta: 'நேரம் வந்தாலும் பதிவு செய்யப்படாத எடைப் பதிவுகள்.' } },
    { id: 'weightOverdue', label: { en: 'Weight overdue', ta: 'தாமதமான எடைப் பதிவு' }, meaning: { en: 'Weight checks still unrecorded more than 3 days after their due date.', ta: 'நேரத்திற்கு 3 நாட்களுக்கு மேல் கடந்தும் பதிவு செய்யப்படாத எடைப் பதிவுகள்.' } },
    { id: 'overdueAging', label: { en: 'Overdue aging', ta: 'தாமத நிலை வகைப்பாடு' }, meaning: { en: 'Overdue weight checks grouped into 0-7, 8-30 and 30+ days late.', ta: 'தாமதமான எடைப் பதிவுகள் 0–7 நாட்கள், 8–30 நாட்கள், 30+ நாட்கள் தாமதம் எனப் பிரிக்கப்பட்டவை.' } },
    { id: 'growthComparison', label: { en: 'Growth comparison', ta: 'வளர்ச்சி ஒப்பீடு' }, meaning: { en: 'Average weekly gain for goats with and without a vaccination record.', ta: 'தடுப்பூசி பதிவு உள்ள ஆடுகளின், இல்லாத ஆடுகளின் சராசரி வாராந்திர வளர்ச்சி.' } },
    { id: 'mortality', label: { en: 'Mortality', ta: 'இறப்பு' }, meaning: { en: 'Share of goats that died, along with their purchase cost as the recorded loss.', ta: 'இறந்த ஆடுகளின் பகுதி, அவற்றின் வாங்கும் செலவு பதிவான இழப்பாகக் காட்டப்படும்.' } },
  ],
  herd: [
    { id: 'goatDistribution', label: { en: 'Goat distribution', ta: 'ஆடுகளின் பங்கீடு' }, meaning: { en: 'Count of filtered goats grouped as active, sold or deceased.', ta: 'வடிகட்டப்பட்ட ஆடுகள் செயலுள்ள, விற்கப்பட்ட, இறந்த எனப் பிரிக்கப்பட்ட எண்ணிக்கை.' } },
    { id: 'purchases', label: { en: 'Purchases', ta: 'வாங்கிய எண்ணிக்கை' }, meaning: { en: 'Number of goats bought each month during the last 8 months.', ta: 'கடந்த 8 மாதங்களில் ஒவ்வொரு மாதமும் எத்தனை ஆடுகள் வாங்கப்பட்டன.' } },
    { id: 'ageStructure', label: { en: 'Age structure', ta: 'வயது அமைப்பு' }, meaning: { en: 'Active goats grouped as under 90 days, 90-180 days and 180+ days on the farm.', ta: 'செயலுள்ள ஆடுகள் 90 நாட்களுக்குக் குறைவு, 90–180 நாட்கள், 180+ நாட்கள் எனப் பிரிக்கப்பட்டவை.' } },
    { id: 'herdMix', label: { en: 'Herd mix', ta: 'ஆடுகளின் கலப்பு' }, meaning: { en: 'Breed composition and male/female count in the current filter.', ta: 'தற்போதைய வடிகட்டலில் இன வகை மற்றும் ஆண்/பெண் எண்ணிக்கை.' } },
    { id: 'herdWeightDue', label: { en: 'Weight due', ta: 'எடைப் பதிவு நேரம் வரவுள்ளது' }, meaning: { en: 'Upcoming weight checks for active goats due in the next 30 days.', ta: 'அடுத்த 30 நாட்களில் நேரம் வரும் செயலுள்ள ஆடுகளின் எடைப் பதிவுகள்.' } },
    { id: 'readyToSell', label: { en: 'Ready to sell', ta: 'விற்பனைக்குத் தயார்' }, meaning: { en: 'An active goat is ready when any one rule is met: W1-W4 is completed, latest weight is 25 kg or more, it is 150+ days on the farm, or a post-purchase weight shows growth below 0.05 kg/day after 60 days.', ta: 'செயலுள்ள ஆடு இந்த நான்கு விதிகளில் ஏதாவது ஒன்று பூர்த்தியானால் தயார்: W1–W4 முடிந்திருக்க வேண்டும், கடைசி நிறை 25 கிலோ அல்லது அதற்கு மேல் இருக்க வேண்டும், விளையில் 150-க்கு மேல் நாட்கள் இருந்திருக்க வேண்டும், அல்லது வாங்கிய பின் எடை பதிவு இருந்து 60 நாட்கள் கழித்து வளர்ச்சி நாளுக்கு 0.05 கிலோக்குக் குறைவாக இருக்க வேண்டும்.' } },
    { id: 'estimatedValue', label: { en: 'Estimated sale value', ta: 'மதிப்பிடப்பட்ட விற்பனை மதிப்பு' }, meaning: { en: 'Latest recorded weight multiplied by the available average sale rate.', ta: 'கடைசியாகப் பதிவான எடையைக் கிடைத்துள்ள சராசரி விற்பனை விலையால் பெருக்கப்படுவது.' } },
    { id: 'estimatedProfit', label: { en: 'Estimated profit', ta: 'மதிப்பிடப்பட்ட லாபம்' }, meaning: { en: 'Estimated sale value minus the goat purchase cost. Sale charges are not included.', ta: 'மதிப்பிடப்பட்ட விற்பனை மதிப்பிலிருந்து அந்த ஆடையின் வாங்கும் செலவு கழித்தது. விற்பனைச் செலவுகள் இதில் சேர்க்கப்படவில்லை.' } },
  ],
};

function downloadCsv(filename: string, rows: (string | number)[][], headers: string[]) {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const FormulaPanel = ({ formula, language, onClose }: { formula: string; language: GuideLanguage; onClose: () => void }) => (
  <div className="mt-3 rounded-md border border-border bg-muted/50 p-3 text-xs leading-relaxed">
    <div className="mb-1 flex items-center justify-between gap-2">
      <p className="font-semibold">{language === 'en' ? 'Formula' : 'கணக்கீடு'}</p>
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose} aria-label={language === 'en' ? 'Close formula' : 'கணக்கீட்டை மூடு'}>
        <X className="h-3 w-3" />
      </Button>
    </div>
    <p className="whitespace-pre-line text-muted-foreground">{formula}</p>
  </div>
);

const Kpi = ({
  title,
  value,
  sub,
  formula,
  language = 'en',
  hoverText,
  hoverContent,
}: {
  title: string;
  value: string;
  sub?: string;
  formula?: string;
  language?: GuideLanguage;
  hoverText?: string;
  hoverContent?: React.ReactNode;
}) => {
  const [showFormula, setShowFormula] = useState(false);
  return (
    <div className="group relative rounded-xl border border-border bg-card p-4" title={hoverText}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground truncate">{title}</p>
        {formula && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            onClick={() => setShowFormula((current) => !current)}
            aria-label={language === 'en' ? 'Show calculation formula' : 'கணக்கீட்டு வாய்ப்பைக் காட்டு'}
            aria-expanded={showFormula}
          >
            <Info className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      {hoverContent && (
        <div className="pointer-events-auto invisible absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground opacity-0 shadow-lg group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
          {hoverContent}
        </div>
      )}
      {formula && showFormula && (
        <FormulaPanel formula={formula} language={language} onClose={() => setShowFormula(false)} />
      )}
    </div>
  );
};

type TagBucketData = { bucket: string; count: number; earTags: string[] };

const isTagBucketData = (value: unknown): value is TagBucketData => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TagBucketData>;
  return typeof candidate.bucket === 'string' && typeof candidate.count === 'number' && Array.isArray(candidate.earTags);
};

const bucketLabel = (bucket: string, language: GuideLanguage) => {
  const labels: Record<string, LocalizedGuideText> = {
    '0–7 days': { en: '0–7 days', ta: '0–7 நாட்கள்' },
    '8–30 days': { en: '8–30 days', ta: '8–30 நாட்கள்' },
    '30+ days': { en: '30+ days', ta: '30+ நாட்கள்' },
    '< 90 days': { en: '< 90 days', ta: '90 நாட்களுக்குக் குறைவு' },
    '90–180 days': { en: '90–180 days', ta: '90–180 நாட்கள்' },
    '180+ days': { en: '180+ days', ta: '180+ நாட்கள்' },
  };
  return labels[bucket]?.[language] ?? bucket;
};

const TagBucketTooltip = ({ active, payload, language = 'en' }: Partial<TooltipContentProps<number, string>> & { language?: GuideLanguage }) => {
  if (!active || !payload?.length) return null;
  const bucket = payload[0]?.payload;
  if (!isTagBucketData(bucket)) return null;
  return (
    <div className="max-w-64 rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground text-xs shadow-md">
      <p className="font-semibold">{bucketLabel(bucket.bucket, language)}</p>
      <p>{tr(language, `${bucket.count} overdue weight check${bucket.count === 1 ? '' : 's'}`, `${bucket.count} தாமதமான எடைப் பதிவுகள்`)}</p>
      <p className="mt-1 text-muted-foreground">{tr(language, 'Goat tags', 'ஆடு எண்கள்')}: {bucket.earTags.length > 0 ? bucket.earTags.join(', ') : tr(language, 'None', 'எதுவும் இல்லை')}</p>
    </div>
  );
};

const HoverTagList = ({ bucket, count, earTags, language }: { bucket: string; count: number; earTags: string[]; language: GuideLanguage }) => (
  <div className="group relative">
    <span
      tabIndex={0}
      title={earTags.length > 0 ? `${tr(language, 'Goat tags', 'ஆடு எண்கள்')}: ${earTags.join(', ')}` : tr(language, 'No goats in this age group', 'இந்த வயது வகையில் ஆடுகள் இல்லை')}
      className="cursor-help rounded-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {bucketLabel(bucket, language)} <b className="text-foreground">{count}</b>
    </span>
    <div
      role="tooltip"
      className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-2 w-max max-w-64 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground opacity-0 shadow-md group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
    >
      {earTags.length > 0 ? earTags.join(', ') : tr(language, 'No goats in this age group', 'இந்த வயது வகையில் ஆடுகள் இல்லை')}
    </div>
  </div>
);

const AnalysisHeader = ({
  title,
  description,
  formula,
  language,
}: {
  title: React.ReactNode;
  description: React.ReactNode;
  formula: string;
  language: GuideLanguage;
}) => {
  const [showFormula, setShowFormula] = useState(false);
  return (
    <CardHeader>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0"
          onClick={() => setShowFormula((current) => !current)}
          aria-label={language === 'en' ? 'Show calculation formula' : 'கணக்கீட்டு வாய்ப்பைக் காட்டு'}
          aria-expanded={showFormula}
        >
          <Info className="h-4 w-4" />
        </Button>
      </div>
      {showFormula && <FormulaPanel formula={formula} language={language} onClose={() => setShowFormula(false)} />}
    </CardHeader>
  );
};

const localizeReadyReason = (reason: string, language: GuideLanguage) => {
  if (language === 'en') return reason;
  return reason.split(' · ').map((part) => {
    if (part === 'W1-W4 weights done') return 'W1–W4 நிறைப் பதிவுகள் முடிந்தன';
    if (part === 'Growth plateaued') return 'வளர்ச்சி முன்னேற்றம் நிறைதான்';
    const targetMatch = part.match(/^([\d.]+)kg target hit$/);
    if (targetMatch) return `${targetMatch[1]} கிலோ இலக்கு அடைந்தது`;
    const daysMatch = part.match(/^(\d+)d on farm$/);
    if (daysMatch) return `விளையில் ${daysMatch[1]} நாட்கள்`;
    return part;
  }).join(' · ');
};

const ReadyTooltip = ({ rows, language, hasRate }: { rows: ReadyDisplayRow[]; language: GuideLanguage; hasRate: boolean }) => (
  <div>
    <p className="font-semibold">{tr(language, `Ready goats and reasons (${rows.length})`, `தயார் ஆடுகளும் காரணங்களும் (${rows.length})`)}</p>
    {rows.length > 0 ? (
      <ul className="mt-2 max-h-[min(20rem,55vh)] space-y-2 overflow-y-auto pr-1">
        {rows.map((row) => (
          <li key={row.earTag} className="border-b border-border/60 pb-2 last:border-0 last:pb-0">
            <div className="flex justify-between gap-3">
              <span className="font-semibold">{row.earTag} · {row.lastWeight} kg</span>
              {hasRate && <span className="text-emerald-600">+{formatCurrency(row.projectedProfit, 'INR')}</span>}
            </div>
            <p className="mt-0.5 text-muted-foreground">{localizeReadyReason(row.reason, language)}</p>
            {hasRate && <p className="text-muted-foreground">{tr(language, `~${formatCurrency(row.projectedAmount, 'INR')} sale`, `~${formatCurrency(row.projectedAmount, 'INR')} விற்பனை`)}</p>}
          </li>
        ))}
      </ul>
    ) : (
      <p className="mt-1 text-muted-foreground">{tr(language, 'No active goat currently matches a readiness rule.', 'தற்போது தயார் விதியைப் பூர்த்திக்கும் செயலுள்ள ஆடு இல்லை.')}</p>
    )}
  </div>
);

const MetricGuide = ({
  tab,
  language,
  expanded,
  readyRows,
  showReadyGoats,
  onLanguageChange,
  onToggle,
  onClose,
  onToggleReadyGoats,
}: {
  tab: Tab;
  language: GuideLanguage;
  expanded: boolean;
  readyRows: { earTag: string; reason: string }[];
  showReadyGoats: boolean;
  onLanguageChange: (language: GuideLanguage) => void;
  onToggle: () => void;
  onClose: () => void;
  onToggleReadyGoats: () => void;
}) => (
  <Card>
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
      <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left" aria-expanded={expanded}>
        <span className="flex items-center gap-2 text-lg font-bold">
          {language === 'en' ? 'How to read this tab' : 'இந்த ஆய்வு தாவலை எப்படி படிக்கவும்'}
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
        {!expanded && (
          <span className="mt-0.5 block text-sm text-muted-foreground">
            {language === 'en'
              ? 'Open plain-language definitions for the current filter.'
              : 'தற்போதைய வடிகட்டலின் விளக்கங்களைத் திறக்கவும்.'}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
        <div className="flex rounded-lg border border-border p-0.5" aria-label={language === 'en' ? 'Guide language' : 'வழிகாட்டி மொழி'}>
          <Button
            variant={language === 'en' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2"
            onClick={() => onLanguageChange('en')}
            aria-pressed={language === 'en'}
          >
            English
          </Button>
          <Button
            variant={language === 'ta' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2"
            onClick={() => onLanguageChange('ta')}
            aria-pressed={language === 'ta'}
          >
            தமிழ்
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label={language === 'en' ? 'Close metric guide' : 'அளவீட்டு வழிகாட்டியை மூடு'}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
    {expanded && (
      <CardContent className="mt-4 divide-y divide-border">
        {TAB_GUIDES[tab].map((item) => {
          const isReadyRule = tab === 'herd' && item.id === 'readyToSell';
          return (
            <div key={item.id} className="grid gap-1 py-3 first:pt-0 last:pb-0 md:grid-cols-[12rem_1fr] md:gap-4">
              <div>
                <p className="text-sm font-semibold">{item.label[language]}</p>
                {isReadyRule && (
                  <button
                    type="button"
                    onClick={onToggleReadyGoats}
                    className="mt-1 text-xs font-medium text-primary hover:underline"
                    aria-expanded={showReadyGoats}
                  >
                    {showReadyGoats
                      ? (language === 'en' ? 'Hide goat numbers' : 'ஆடு எண்களை மறை')
                      : (language === 'en' ? `Show goat numbers (${readyRows.length})` : `ஆடு எண்களைக் காட்டு (${readyRows.length})`)}
                  </button>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{item.meaning[language]}</p>
                {isReadyRule && showReadyGoats && (
                  <div className="mt-2 rounded-lg bg-muted/50 p-3">
                    {readyRows.length > 0 ? (
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {readyRows.map((row) => (
                          <li key={row.earTag} className="flex justify-between gap-3 text-xs">
                            <span className="font-semibold">{row.earTag}</span>
                            <span className="text-right text-muted-foreground">{localizeReadyReason(row.reason, language)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {language === 'en'
                          ? 'No active goat currently matches a readiness rule.'
                          : 'தற்போது தயார் விதியைப் பூர்த்திக்கும் செயலுள்ள ஆடு இல்லை.'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    )}
  </Card>
);

export const AnalyticsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, viewingHerdId } = useAuth();
  const { scoped, isLoading, isError, refetch } = useAnalyticsData(user?.id, viewingHerdId);

  const [tab, setTab] = useState<Tab>('profit');
  const [guideVisible, setGuideVisible] = useState(true);
  const [guideExpanded, setGuideExpanded] = useState(false);
  const [guideLanguage, setGuideLanguage] = useState<GuideLanguage>('en');
  const [showReadyGoats, setShowReadyGoats] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [variant, setVariant] = useState('');
  const [gender, setGender] = useState<'' | 'male' | 'female'>('');
  const t = (en: string, _ta?: string) => en;

  const variants = useMemo(() => distinctVariants(scoped.goats), [scoped.goats]);

  const filtered = useMemo(() => {
    const goats = filterGoats(
      scoped.goats,
      {
        from: from ? new Date(from) : null,
        to: to ? new Date(to) : null,
        variant: variant || undefined,
        gender: gender || undefined,
      },
    );
    const ids = new Set(goats.map((g) => g.id));
    return {
      goats,
      weights: scoped.weights.filter((w) => ids.has(w.goatId)),
      dewormings: scoped.dewormings.filter((d) => ids.has(d.goatId)),
      vaccinations: scoped.vaccinations.filter((v) => ids.has(v.goatId)),
    };
  }, [scoped, from, to, variant, gender]);

  const fin = useMemo(() => computeFinancials(filtered.goats, filtered.weights), [filtered]);
  const growth = useMemo(() => computeGrowth(filtered.goats, filtered.weights), [filtered]);
  const health = useMemo(
    () => computeHealth(filtered.goats, filtered.weights, filtered.dewormings, filtered.vaccinations, growth.rows),
    [filtered, growth.rows],
  );
  const herd = useMemo(() => computeHerd(filtered.goats, filtered.weights), [filtered]);
  const ready = useMemo(
    () => computeReadyToSell(filtered.goats, filtered.weights, fin.avgRatePerKg || 0),
    [filtered, fin.avgRatePerKg],
  );
  const goatDistribution = useMemo(
    () => [
      { name: 'Active', value: filtered.goats.filter((goat) => goat.status === 'active').length },
      { name: 'Sold', value: filtered.goats.filter((goat) => goat.status === 'sold').length },
      { name: 'Deceased', value: filtered.goats.filter((goat) => goat.status === 'deceased').length },
    ],
    [filtered.goats],
  );
  const overdueEarTags = useMemo(
    () => [...new Set(health.overdueBuckets.flatMap((bucket) => bucket.earTags))].sort((a, b) => a.localeCompare(b)),
    [health.overdueBuckets],
  );

  const resetFilters = () => {
    setFrom('');
    setTo('');
    setVariant('');
    setGender('');
  };

  const handleExport = () => {
    downloadCsv(
      `goatie_analytics_${new Date().toISOString().split('T')[0]}.csv`,
      [
        ...fin.monthly.map((m) => ['monthly', m.label, m.count, m.revenue, m.profit, m.avgRate] as (string | number)[]),
        ...growth.rows.map((r) => ['goat', r.earTag, r.variant, r.gender, r.status, r.purchaseWeight, r.lastWeight, r.gain, r.monthlyGain, r.weeklyGain] as (string | number)[]),
      ],
      ['section', 'label_or_eartag', 'variant_or_count', 'gender_or_revenue', 'status_or_profit', 'purchase_wt', 'last_wt', 'gain', 'monthly_gain', 'weekly_gain'],
    );
  };

  if (isLoading) {
    return <div className="py-16 text-center text-muted-foreground">{t('Loading analytics…', 'ஆய்வுகள் ஏற்றப்படுகின்றன…')}</div>;
  }
  if (isError) {
    return (
      <div className="py-16 text-center space-y-4">
        <p className="text-muted-foreground">{t('Could not load analytics data.', 'ஆய்வுத் தரவை ஏற்ற முடியவில்லை.')}</p>
        <Button onClick={() => refetch()}>{t('Retry', 'மீண்டும் முயற்சிக்கவும்')}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} aria-label={t('Back to dashboard', 'டாஷ்போர்டுக்குத் திரும்பவும்')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{t('Farm Analytics', 'பண்ணை ஆய்வுகள்')}</h1>
            <p className="text-sm text-muted-foreground">
              {t(
                `${filtered.goats.length} goats in scope · computed offline from your herd data`,
                `வடிகட்டலில் ${filtered.goats.length} ஆடுகள் · உங்கள் ஆடுகளின் தரவிலிருந்து இணைப்பில்லாமல் கணக்கிடப்பட்டது`,
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HerdSwitcher />
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" /> {t('Export CSV', 'CSV ஏற்றுமதி')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-6">
          <div>
            <Label htmlFor="f-from">{t('From', 'தொடங்கும் தேதி')}</Label>
            <Input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="f-to">{t('To', 'முடிவு தேதி')}</Label>
            <Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="f-variant">{t('Variant', 'இனம்')}</Label>
            <select
              id="f-variant"
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
            >
              <option value="">{t('All variants', 'அனைத்து இனங்களும்')}</option>
              {variants.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="f-gender">{t('Gender', 'பாலினம்')}</Label>
            <select
              id="f-gender"
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
              value={gender}
              onChange={(e) => setGender(e.target.value as '' | 'male' | 'female')}
            >
              <option value="">{t('Both', 'இரு பாலினங்களும்')}</option>
              <option value="male">{t('Male', 'ஆண்')}</option>
              <option value="female">{t('Female', 'பெண்')}</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button variant="ghost" size="sm" onClick={resetFilters}>{t('Reset', 'மீட்டமை')}</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          title={t('Total Revenue', 'மொத்த வருவாய்')}
          value={formatCurrency(fin.totalRevenue, 'INR')}
          sub={t(`${fin.soldCount} goats sold`, `${fin.soldCount} ஆடுகள் விற்கப்பட்டன`)}
          formula={t('Total revenue = Σ saleAmount for completed sales', 'மொத்த வருவாய் = முடிந்த விற்பனைகளின் விற்பனைத் தொகை (Σ saleAmount)')}
          language="en"
        />
        <Kpi
          title={t('Total Profit', 'மொத்த லாபம்')}
          value={formatCurrency(fin.totalProfit, 'INR')}
          sub={t(`ROI ${fin.roi}% · avg ${formatCurrency(fin.avgProfit, 'INR')}/goat`, `ROI ${fin.roi}% · சராசரி ${formatCurrency(fin.avgProfit, 'INR')}/ஆடு`)}
          formula={t(
            'Profit = sale amount − purchase cost − commission − transport − other charges\nROI = total profit ÷ sold purchase cost × 100',
            'லாபம் = விற்பனைத் தொகை − வாங்கும் செலவு − கமிஷன் − ஓச்சார் − பிற செலவுகள்\nROI = மொத்த லாபம் ÷ விற்கப்பட்ட ஆடுகளின் வாங்கும் செலவு × 100',
          )}
          language="en"
        />
        <Kpi
          title={t('Avg Sale Rate', 'சராசரி விற்பனை விலை')}
          value={`₹${fin.avgRatePerKg}/${t('kg', 'கிலோ')}`}
          sub={t(`Active herd projected value ${formatCurrency(fin.inventoryProjectedValue, 'INR')}`, `செயலுள்ள ஆடுகளின் மதிப்பிடப்பட்ட மதிப்பு ${formatCurrency(fin.inventoryProjectedValue, 'INR')}`)}
          formula={t('Average sale rate = Σ saleRatePerKg ÷ number of sales with a rate above 0', 'சராசரி விற்பனை விலை = 0-ஐ விட அதிக விலையுள்ள விற்பனைகளின் கிலோ விலைத் தொகை ÷ விற்பனைகளின் எண்ணிக்கை')}
          language="en"
        />
        <Kpi
          title={t('Avg Weekly Growth', 'சராசரி வாராந்திர வளர்ச்சி')}
          value={`${growth.herdAvgWeeklyGain} ${t('kg/wk', 'கிலோ/வாரம்')}`}
          sub={t(`Avg gain ${growth.herdAvgGain}kg · average hold ${growth.avgHoldingDays}d`, `சராசரி நிறை சேர்க்கை ${growth.herdAvgGain} கிலோ · சராசரி வளர்ப்புக் காலம் ${growth.avgHoldingDays} நாட்கள்`)}
          formula={t(
            'Weekly gain = (latest weight − purchase weight) ÷ days on farm × 7\nHerd average = mean of each eligible goat’s weekly gain',
            'வாராந்திர நிறை சேர்க்கை = (கடைசி நிறை − வாங்கியபோதைய நிறை) ÷ விளையில் இருந்த நாட்கள் × 7\nஆடுகளின் சராசரி = உரிய ஒவ்வொரு ஆடின் வாராந்திர நிறை சேர்க்கையின் சராசரி',
          )}
          language="en"
        />
        <Kpi
          title={t('Vaccination Coverage', 'தடுப்பூசி பாதுகாப்பு')}
          value={`${health.vaccCoverage}%`}
          sub={t(`Deworming ${health.dewormCoverage}% · weight records ${health.weightCompliance}%`, `முற்பை நீக்கல் ${health.dewormCoverage}% · எடைப் பதிவுகள் ${health.weightCompliance}%`)}
          formula={t('Coverage = goats with a record ÷ active goats × 100', 'பாதுகாப்பு = பதிவு உள்ள ஆடுகள் ÷ செயலுள்ள ஆடுகள் × 100')}
          language="en"
        />
        <Kpi
          title={t('Weight Overdue', 'தாமதமான எடைப் பதிவு')}
          value={String(health.weightOverdue)}
          sub={t(`${health.weightDue} weight checks due in total`, `மொத்தம் ${health.weightDue} எடைப் பதிவுகள் நேரம் வரவுள்ளன`)}
          formula={t('Overdue = unrecorded weight AND today − due date > 3 days', 'தாமதம் = பதிவு செய்யப்படாத எடை AND இன்று − நேரம் வந்த தேதி > 3 நாட்கள்')}
          language="en"
          hoverText={overdueEarTags.length > 0 ? `${t('Goat tags', 'ஆடு எண்கள்')}: ${overdueEarTags.join(', ')}` : t('No overdue weight checks', 'தாமதமான எடைப் பதிவுகள் இல்லை')}
        />
        <Kpi
          title={t('Mortality', 'இறப்பு')}
          value={`${health.mortalityRate}%`}
          sub={t(`${health.deadCount} dead · purchase loss ${formatCurrency(health.deathLoss, 'INR')}`, `இறந்தவை ${health.deadCount} · வாங்கும் இழப்பு ${formatCurrency(health.deathLoss, 'INR')}`)}
          formula={t('Mortality rate = deceased goats ÷ all filtered goats × 100', 'இறப்பு விகிதம் = இறந்த ஆடுகள் ÷ வடிகட்டப்பட்ட அனைத்து ஆடுகள் × 100')}
          language="en"
        />
        <Kpi
          title={t('Ready to Sell', 'விற்பனைக்குத் தயார்')}
          value={String(ready.length)}
          sub={t('Meets at least one readiness rule', 'குறைந்தது ஒரு தயார் விதியைப் பூர்த்திக்கிறது')}
          formula={t(
            'Active goat is ready when any one rule is true:\nW1–W4 complete OR ≥25 kg OR ≥150 days\nOR slow growth (<0.05 kg/day) after 60 days with a post-purchase weight',
            'செயலுள்ள ஆடு ஒரு விதி பொருந்தும்போது தயார்:\nW1–W4 முடிந்திருக்க வேண்டம் அல்லது ≥25 கிலோ அல்லது ≥150 நாட்கள்\nஅல்லது 60 நாட்களுக்குப் பின், வாங்கிய பின் எடை பதிவு இருந்து வளர்ச்சி <0.05 கிலோ/நாள்',
          )}
          language="en"
          hoverContent={<ReadyTooltip rows={ready} language="en" hasRate={fin.avgRatePerKg > 0} />}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2 flex-wrap">
          {([
            ['profit', t('Profit & Sales', 'லாபம் & விற்பனைகள்')],
            ['growth', t('Growth', 'வளர்ச்சி')],
            ['health', t('Health', 'நலம்')],
            ['herd', t('Herd & Ops', 'ஆடுகள் & செயல்பாடுகள்')],
          ] as [Tab, string][]).map(([key, label]) => (
            <Button
              key={key}
              variant={tab === key ? 'primary' : 'outline'}
              size="sm"
              onClick={() => {
                setTab(key);
                setShowReadyGoats(false);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        {!guideVisible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setGuideVisible(true);
              setGuideExpanded(true);
            }}
          >
            {guideLanguage === 'en' ? 'How to read this tab' : 'இந்த ஆய்வு தாவலை எப்படி படிக்கவும்'}
          </Button>
        )}
      </div>

      {filtered.goats.length > 0 && guideVisible && (
        <MetricGuide
          tab={tab}
          language={guideLanguage}
          expanded={guideExpanded}
          readyRows={ready}
          showReadyGoats={showReadyGoats}
          onLanguageChange={setGuideLanguage}
          onToggle={() => setGuideExpanded((current) => !current)}
          onClose={() => {
            setGuideVisible(false);
            setGuideExpanded(false);
            setShowReadyGoats(false);
          }}
          onToggleReadyGoats={() => setShowReadyGoats((current) => !current)}
        />
      )}

      {filtered.goats.length === 0 && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No goats match these filters.</CardContent></Card>
      )}

      {tab === 'profit' && filtered.goats.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="lg:col-span-2">
            <AnalysisHeader
              title="Investment and returns"
              description="Purchase cost, recovered revenue and estimated value for the goats in this filter."
              formula={'Total investment = Σ purchasePrice (all filtered goats)\nSales revenue = Σ saleAmount (sold goats)\nROI = total profit ÷ sold purchase cost × 100\nProjected active value = Σ(lastWeight × recent avg sale rate)'}
              language="en"
            />
            <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Total investment</p>
                <p className="mt-1 text-xl font-bold">{formatCurrency(fin.totalInvestment, 'INR')}</p>
                <p className="mt-1 text-xs text-muted-foreground">Purchase cost of every goat in scope</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Sales revenue</p>
                <p className="mt-1 text-xl font-bold">{formatCurrency(fin.totalRevenue, 'INR')}</p>
                <p className="mt-1 text-xs text-muted-foreground">Recovered from {fin.soldCount} completed sales</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Sold goat purchase cost</p>
                <p className="mt-1 text-xl font-bold">{formatCurrency(fin.totalPurchaseCostSold, 'INR')}</p>
                <p className="mt-1 text-xs text-muted-foreground">Cost basis used for ROI</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Sale deductions</p>
                <p className="mt-1 text-xl font-bold">{formatCurrency(fin.totalDeductions, 'INR')}</p>
                <p className="mt-1 text-xs text-muted-foreground">Commission, transport and other charges</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Active herd cost</p>
                <p className="mt-1 text-xl font-bold">{formatCurrency(fin.inventoryPurchaseValue, 'INR')}</p>
                <p className="mt-1 text-xs text-muted-foreground">Purchase cost still in inventory</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Projected active value</p>
                <p className="mt-1 text-xl font-bold">{formatCurrency(fin.inventoryProjectedValue, 'INR')}</p>
                <p className="mt-1 text-xs text-muted-foreground">Estimated from recent sale rates</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title="Revenue vs Profit"
              description="Last 8 months by sale date"
              formula={'Monthly revenue = Σ saleAmount for sales in that month\nMonthly profit = Σ netProfit for sales in that month'}
              language="en"
            />
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={fin.monthly}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v), 'INR')} />
                  <Legend />
                  <Area type="monotone" dataKey="revenue" name="Revenue ₹" stroke="#10b981" fill="#10b98133" />
                  <Area type="monotone" dataKey="profit" name="Profit ₹" stroke="#3b82f6" fill="#3b82f633" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title="Monthly Sales Trend"
              description="Goat sales over the last 6 months"
              formula={'Monthly sales = count of sold goats whose sale date falls in that month'}
              language="en"
            />
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={fin.monthly.slice(-6)}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Sales" fill="#10b981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title="Rate / kg trend"
              description="Avg sale rate per month — when to sell"
              formula={'Monthly average rate = Σ saleRatePerKg ÷ number of sales with a rate above 0'}
              language="en"
            />
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={fin.rateTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `₹${v}/kg`} />
                  <Line type="monotone" dataKey="avgRate" name="₹/kg" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title="Profit by variant"
              description="Which breed pays"
              formula={'Variant profit = Σ netProfit grouped by variant\nFallback profit = sale amount − purchase cost − commission − transport − other charges'}
              language="en"
            />
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={fin.byVariant}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="variant" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v), 'INR')} />
                  <Bar dataKey="profit" name="Profit ₹" fill="#10b981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 text-sm space-y-1">
                {fin.byGender.map((g) => (
                  <div key={g.gender} className="flex justify-between">
                    <span className="capitalize text-muted-foreground">{g.gender}</span>
                    <span>{g.count} sold · {formatCurrency(g.profit, 'INR')}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t">
                  <span className="text-muted-foreground">Deductions</span>
                  <span>Commission {formatCurrency(fin.commission, 'INR')} · Transport {formatCurrency(fin.transport, 'INR')} · Other {formatCurrency(fin.other, 'INR')}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title="Top buyers"
              description="By revenue"
              formula={'Buyer revenue = Σ saleAmount grouped by buyerName\nSort buyers by total revenue; show the top 8'}
              language="en"
            />
            <CardContent>
              {fin.topBuyers.length === 0 && <p className="text-sm text-muted-foreground">No sales yet — sell a goat to unlock this.</p>}
              <div className="space-y-2">
                {fin.topBuyers.map((b) => (
                  <div key={b.buyer} className="flex justify-between text-sm border-b border-border/50 pb-2">
                    <span className="font-medium">{b.buyer} <span className="text-muted-foreground">×{b.count}</span></span>
                    <span>{formatCurrency(b.revenue, 'INR')} · ₹{b.avgRate}/kg</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-sm grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Active herd purchase cost</p><p className="font-bold">{formatCurrency(fin.inventoryPurchaseValue, 'INR')}</p></div>
                <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Projected sale value at current rate</p><p className="font-bold">{formatCurrency(fin.inventoryProjectedValue, 'INR')}</p></div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'growth' && filtered.goats.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <AnalysisHeader
              title="Herd growth curve"
              description="Avg weight Purchase → W4 → Sale"
              formula={'Stage average weight = Σ valid recorded weight at that stage ÷ number of records\nStages: purchase, W1, W2, W3, W4, sale'}
              language="en"
            />
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={growth.growthCurve}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${v} kg`} />
                  <Line type="monotone" dataKey="avgWeight" name="Avg kg" stroke="#06b6d4" strokeWidth={2.5} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground mt-2">Avg holding period for sold goats: {growth.avgHoldingDays} days.</p>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title="Monthly gain distribution"
              description="Stunted = active, 30d+, &lt;1.5kg/mo"
              formula={'Daily gain = (latest weight − purchase weight) ÷ days on farm\nMonthly gain = daily gain × 30\nCount goats in each monthly-gain range'}
              language="en"
            />
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={growth.gainBuckets}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 text-sm space-y-1">
                {growth.variantCompare.map((v) => (
                  <div key={v.variant} className="flex justify-between">
                    <span className="text-muted-foreground">{v.variant} ×{v.count}</span>
                    <span>{v.avgWeeklyGain} kg/wk · +{v.avgGain}kg</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title="Top growers"
              description="By average weekly gain"
              formula={'Weekly gain = (latest weight − purchase weight) ÷ days on farm × 7\nSort all goats by weekly gain; show the top 5'}
              language="en"
            />
            <CardContent>
              <div className="space-y-2 text-sm">
                {growth.topGrowers.map((r) => (
                  <div key={r.goatId} className="flex justify-between border-b border-border/50 pb-2">
                    <span className="font-medium">{r.earTag} <span className="text-muted-foreground">{r.variant}</span></span>
                    <span>+{r.gain}kg · {r.weeklyGain} kg/wk</span>
                  </div>
                ))}
                {growth.topGrowers.length === 0 && <p className="text-muted-foreground">No weight data yet.</p>}
              </div>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title={`Needs attention (${growth.stunted.length})`}
              description="Slowest + stunted active goats"
              formula={'Stunted = active goat AND days on farm ≥ 30 AND monthly gain &lt; 1.5 kg'}
              language="en"
            />
            <CardContent>
              <div className="space-y-2 text-sm">
                {growth.stunted.slice(0, 10).map((r) => (
                  <div key={r.goatId} className="flex justify-between border-b border-border/50 pb-2">
                    <span className="font-medium">{r.earTag} <span className="text-muted-foreground">{r.daysOnFarm}d</span></span>
                    <span className="text-red-500">{r.monthlyGain} kg/mo</span>
                  </div>
                ))}
                {growth.stunted.length === 0 && <p className="text-muted-foreground">No stunted goats — herd is gaining well.</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'health' && filtered.goats.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <AnalysisHeader
              title="Coverage"
              description="Active herd compliance"
              formula={'Vaccination or deworming coverage = goats with a record ÷ active goats × 100\nWeight compliance = recorded due weights ÷ all due weights × 100'}
              language="en"
            />
            <CardContent className="space-y-3 text-sm">
              {[
                ['Vaccinated', health.vaccCoverage, health.pendingVacc],
                ['Dewormed', health.dewormCoverage, health.pendingDeworm],
                ['Weight compliance', health.weightCompliance, health.weightDue],
              ].map(([label, pct, pending]) => (
                <div key={label as string}>
                  <div className="flex justify-between mb-1"><span>{label}</span><span className="font-bold">{pct}% · {pending} pending</span></div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, Number(pct))}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-2">
                Vaccinated growth {health.vaccWeeklyGain} kg/wk vs pending {health.pendingWeeklyGain} kg/wk — health pays in weight.
              </p>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title="Overdue aging"
              description="Weight checks not recorded more than 3 days after their due date, grouped by how late"
              formula={'Days late = today − due date\nOverdue = unrecorded AND days late &gt; 3\nGroup into 0–7, 8–30 and 30+ days late'}
              language="en"
            />
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={health.overdueBuckets}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip content={<TagBucketTooltip language="en" />} />
                  <Bar dataKey="count" fill="#ef4444" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <AnalysisHeader
              title="Mortality"
              description="Dead-goat loss is real cost — currently excluded from dashboard charts"
              formula={'Mortality rate = deceased goats ÷ all filtered goats × 100\nPurchase loss = Σ purchasePrice of deceased goats'}
              language="en"
            />
            <CardContent className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-muted/50 p-4"><p className="text-xs text-muted-foreground">Rate</p><p className="text-2xl font-bold">{health.mortalityRate}%</p></div>
              <div className="rounded-lg bg-muted/50 p-4"><p className="text-xs text-muted-foreground">Deaths</p><p className="text-2xl font-bold">{health.deadCount}</p></div>
              <div className="rounded-lg bg-muted/50 p-4"><p className="text-xs text-muted-foreground">Purchase loss</p><p className="text-2xl font-bold">{formatCurrency(health.deathLoss, 'INR')}</p></div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'herd' && filtered.goats.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <AnalysisHeader
              title="Goat Distribution"
              description="Active vs Sold vs Deceased goats"
              formula={'Distribution value = count of filtered goats grouped by status'}
              language="en"
            />
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={goatDistribution} barSize={48}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" name="Goats" fill="#10b981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title="Purchases"
              description="Last 8 months"
              formula={'Monthly purchases = count of goats whose purchase date falls in that month\nAge on farm = today − purchase date for active goats'}
              language="en"
            />
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={herd.purchaseTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Bought" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 text-sm flex gap-4">
                <span>Age on farm:</span>
                {herd.ageStructure.map((a) => (
                  <HoverTagList key={a.bucket} bucket={a.bucket} count={a.count} earTags={a.earTags} language="en" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title="Herd mix"
              description="Variant + sex"
              formula={'Variant mix = count of filtered goats grouped by variant\nSex ratio = count of male goats and count of female goats'}
              language="en"
            />
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={herd.variantMix} dataKey="value" nameKey="name" outerRadius={90} label>
                    {herd.variantMix.map((_, i) => (<Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              <p className="text-sm text-muted-foreground text-center">
                {herd.sexRatio.map((s) => `${s.name} ${s.value}`).join(' · ')}
              </p>
            </CardContent>
          </Card>
          <Card>
            <AnalysisHeader
              title={`Weight due — next 30 days (${herd.dueForecast.length})`}
              description="Stay ahead of overdue"
              formula={'Include unrecorded weights for active goats due from today through today + 30 days\nDays until due = due date − today'}
              language="en"
            />
            <CardContent>
              <div className="space-y-2 text-sm max-h-64 overflow-y-auto">
                {herd.dueForecast.map((d) => (
                  <div key={d.goatId + d.weightNumber} className="flex justify-between border-b border-border/50 pb-2">
                    <span className="font-medium">{d.earTag} <span className="text-muted-foreground">W{d.weightNumber}</span></span>
                    <span>{d.daysUntil === 0 ? 'Due today' : `in ${d.daysUntil}d`}</span>
                  </div>
                ))}
                {herd.dueForecast.length === 0 && <p className="text-muted-foreground">Nothing due in the next 30 days.</p>}
              </div>
            </CardContent>
          </Card>
          <Card className="group relative">
            <AnalysisHeader
              title={`Ready to sell (${ready.length})`}
              description={fin.avgRatePerKg ? `Estimated at ₹${fin.avgRatePerKg}/kg` : 'Add a completed sale to estimate value and profit'}
              formula={'Ready if active AND any rule is true:\nW1–W4 complete OR latest weight ≥ 25 kg OR days on farm ≥ 150\nOR post-purchase weight exists AND growth &lt; 0.05 kg/day AND days ≥ 60\nEstimated profit = latest weight × average sale rate − purchase cost'}
              language="en"
            />
            <div className="pointer-events-auto invisible absolute right-4 top-20 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground opacity-0 shadow-lg group-hover:visible group-hover:opacity-100">
              <ReadyTooltip rows={ready} language="en" hasRate={fin.avgRatePerKg > 0} />
            </div>
            <CardContent>
              <div className="mb-3 rounded-lg bg-muted/50 p-3 text-xs">
                <p className="font-semibold">An active goat appears when any one rule is met:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
                  <li>Monthly weight checks W1-W4 are completed</li>
                  <li>Latest weight is 25 kg or more</li>
                  <li>It has been on the farm for 150 days or more</li>
                  <li>After 60 days, a post-purchase weight is recorded and growth is under 0.05 kg/day</li>
                </ul>
              </div>
              <div className="space-y-2 text-sm max-h-96 overflow-y-auto pr-1">
                {ready.map((r) => (
                  <div key={r.goatId} className="border-b border-border/50 pb-2">
                    <div className="flex justify-between"><span className="font-medium">{r.earTag} · {r.lastWeight}kg</span><span className={fin.avgRatePerKg ? 'font-bold text-emerald-600' : 'text-muted-foreground'}>{fin.avgRatePerKg ? `+${formatCurrency(r.projectedProfit, 'INR')}` : 'Rate needed'}</span></div>
                    <p className="text-xs text-muted-foreground">{r.reason}{fin.avgRatePerKg ? ` · ~${formatCurrency(r.projectedAmount, 'INR')} sale` : ''}</p>
                  </div>
                ))}
                {ready.length === 0 && <p className="text-muted-foreground">No goats meet sell-readiness yet. Record weights to unlock this.</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default AnalyticsPage;
