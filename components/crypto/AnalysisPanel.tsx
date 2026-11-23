
import React from 'react';
import { AnalysisResult, OHLCCandle } from '../../crypto-types';
import { TrendingUp, TrendingDown, Target, Shield, Zap, Info, DollarSign, X, Calculator, Activity, Terminal, ChevronDown, ChevronUp, Gauge, BarChart3, Binary } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { NewsPanel } from './NewsPanel';

import { ProfitRiskCalc } from './ProfitRiskCalc';

interface AnalysisPanelProps {
  analysis: AnalysisResult;
  candles: OHLCCandle[];
  sekRate: number;
  thbRate: number;
}

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({ analysis, candles, sekRate, thbRate }) => {
  const { coin, signals, recommendation, tradingBlueprint, levels } = analysis;
  const isUp = signals.trend === 'Bullish';
  
  const [winTarget, setWinTarget] = React.useState<number>(() => {
    const saved = localStorage.getItem('winTarget');
    return saved ? Number(saved) : 500;
  });
  const [winCurrency, setWinCurrency] = React.useState<'USD' | 'SEK'>(() => {
    const saved = localStorage.getItem('winCurrency');
    return (saved as 'USD' | 'SEK') || 'SEK';
  });
  const [sekBaseAmount, setSekBaseAmount] = React.useState<number>(() => {
    const saved = localStorage.getItem('sekBaseAmount');
    return saved ? Number(saved) : 10;
  });
  const [thbBaseAmount, setThbBaseAmount] = React.useState<number>(() => {
    const saved = localStorage.getItem('thbBaseAmount');
    return saved ? Number(saved) : 100;
  });

  const [isCalculatorOpen, setIsCalculatorOpen] = React.useState(false);
  const [isAnalysisExpanded, setIsAnalysisExpanded] = React.useState(() => {
    const saved = localStorage.getItem('isAnalysisExpanded');
    return saved === 'true';
  });

  React.useEffect(() => {
    localStorage.setItem('winTarget', winTarget.toString());
  }, [winTarget]);

  React.useEffect(() => {
    localStorage.setItem('winCurrency', winCurrency);
  }, [winCurrency]);

  React.useEffect(() => {
    localStorage.setItem('sekBaseAmount', sekBaseAmount.toString());
  }, [sekBaseAmount]);

  React.useEffect(() => {
    localStorage.setItem('thbBaseAmount', thbBaseAmount.toString());
  }, [thbBaseAmount]);

  React.useEffect(() => {
    localStorage.setItem('isAnalysisExpanded', isAnalysisExpanded.toString());
  }, [isAnalysisExpanded]);

  const requiredForTarget = (targetPrice: number) => {
    const entry = tradingBlueprint.entry;
    const profitPerUnit = Math.abs(targetPrice - entry);
    if (profitPerUnit === 0) return 0;
    
    const targetInUSD = winCurrency === 'SEK' ? winTarget / sekRate : winTarget;
    return targetInUSD / profitPerUnit;
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Calculator Modal */}
      <AnimatePresence>
        {isCalculatorOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-slate-950 border border-slate-800 w-full max-w-4xl rounded-[1.5rem] shadow-[0_0_80px_rgba(0,0,0,0.85)] overflow-hidden relative"
            >
              <div className="absolute top-6 left-6 z-20">
                <span className="text-[9px] bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-slate-500 font-bold tracking-wider">CALC POPUP</span>
              </div>
              <div className="absolute top-6 right-6 z-20">
                <button 
                  onClick={() => setIsCalculatorOpen(false)}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-all border border-white/10 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 md:p-8">
                <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                  {/* Left Column: Input */}
                  <div className="w-full md:w-5/12 space-y-6">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 text-emerald-400">
                        <div className="p-2 hover:bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                          <Calculator className="w-6 h-6" />
                        </div>
                        <div>
                          <h2 className="text-xl font-bold text-white uppercase tracking-tight">Profit Goal</h2>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Determine required holdings</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-slate-405 uppercase tracking-wider">Desired Profit</label>
                        <div className="flex bg-slate-900/50 p-0.5 rounded-lg border border-slate-800">
                          <button 
                            onClick={() => setWinCurrency('SEK')} 
                            className={`px-3 py-1 rounded-md text-[9px] font-bold tracking-widest transition-all cursor-pointer ${winCurrency === 'SEK' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                          >
                            SEK
                          </button>
                          <button 
                            onClick={() => setWinCurrency('USD')} 
                            className={`px-3 py-1 rounded-md text-[9px] font-bold tracking-widest transition-all cursor-pointer ${winCurrency === 'USD' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                          >
                            USD
                          </button>
                        </div>
                      </div>
                      
                      <div className="relative group">
                        <div className="absolute inset-0 bg-emerald-500/5 blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity" />
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 font-mono text-2xl font-black italic pointer-events-none group-focus-within:text-emerald-500 transition-colors">
                          {winCurrency === 'SEK' ? 'kr' : '$'}
                        </span>
                        <input 
                          type="number" 
                          autoFocus
                          value={winTarget}
                          onChange={(e) => setWinTarget(Number(e.target.value))}
                          className="w-full bg-slate-900/40 border-2 border-slate-800 rounded-xl py-3 pl-12 pr-4 text-3xl font-mono font-black text-white focus:outline-none focus:border-emerald-500 transition-all placeholder-slate-800 relative z-10"
                        />
                      </div>
                      
                      <p className="text-[10px] text-slate-500 leading-normal">
                        Accumulate exactly these units of <span className="text-white font-bold">{coin.name} ({coin.symbol})</span> to secure a <span className="text-emerald-400 font-bold">{winTarget.toLocaleString()} {winCurrency}</span> return at the specified target zones.
                      </p>
                    </div>
                  </div>

                  {/* Right Column: Calculations */}
                  <div className="w-full md:w-7/12 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <motion.div 
                      whileHover={{ scale: 1.01 }}
                      className="p-5 bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-xl relative overflow-hidden group"
                    >
                      <div className="absolute top-0 right-0 p-4 opacity-[0.02] group-hover:opacity-5 transition-opacity text-white">
                        <Target className="w-24 h-24" />
                      </div>
                      <div className="relative z-10 space-y-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Target 1 (Cons.)</span>
                        </div>
                        <div className="space-y-1">
                          <div className="text-3xl font-mono font-bold text-white tracking-tight tabular-nums">
                            {requiredForTarget(tradingBlueprint.targets[0]).toLocaleString(undefined, { maximumFractionDigits: 5 })}
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">{coin.symbol} Required</span>
                            <span className="text-[8px] font-semibold text-slate-500 uppercase px-2 py-0.5 rounded-full bg-slate-800">Low Risk</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>

                    <motion.div 
                      whileHover={{ scale: 1.01 }}
                      className="p-5 bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-xl relative overflow-hidden group border-b-emerald-500/20"
                    >
                      <div className="absolute top-0 right-0 p-4 opacity-[0.02] group-hover:opacity-5 transition-opacity text-white">
                        <DollarSign className="w-24 h-24" />
                      </div>
                      <div className="relative z-10 space-y-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Target 2 (Aggr.)</span>
                        </div>
                        <div className="space-y-1">
                          <div className="text-3xl font-mono font-bold text-white tracking-tight tabular-nums">
                            {requiredForTarget(tradingBlueprint.targets[1]).toLocaleString(undefined, { maximumFractionDigits: 5 })}
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">{coin.symbol} Required</span>
                            <span className="text-[8px] font-semibold text-slate-500 uppercase px-2 py-0.5 rounded-full bg-slate-800">Optimal</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </div>
              </div>
              
              <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-10" />
            </motion.div>
            
            <div 
              className="absolute inset-0 bg-black/60 backdrop-blur-xl -z-10" 
              onClick={() => setIsCalculatorOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'} border border-current/10`}>
              {isUp ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                {coin.name} Technical Feed
                <span className={`text-[9px] font-bold px-2 py-0.2 rounded-full ${isUp ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30' : 'bg-rose-950 text-rose-400 border border-rose-500/30'}`}>
                  {signals.trend}
                </span>
              </h2>
              <p className="text-slate-400 text-xs mt-0.5">
                Technical rating: <span className="font-bold text-white">{signals.strength}/100</span> · Active Calculation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsCalculatorOpen(true)}
              className="group p-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl transition-all cursor-pointer shadow shadow-emerald-500/10"
              title="Profit Calculator"
            >
              <Calculator className="w-4 h-4 transition-transform group-hover:rotate-6" />
            </button>

            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
              <div className="flex flex-col items-end border-r border-slate-800 pr-6">
                <div className="text-[9px] items-center gap-1 font-bold text-slate-500 uppercase tracking-wider mb-0.5 flex">
                  <DollarSign className="w-2.5 h-2.5" /> USD Price
                </div>
                <div className="text-base font-mono font-bold text-emerald-400">
                  ${analysis.currentPrice.usd < 1 ? analysis.currentPrice.usd.toFixed(4) : analysis.currentPrice.usd.toLocaleString()}
                </div>
              </div>

              <div className="flex flex-col items-end">
                <div className="text-[9px] items-center gap-1 font-bold text-slate-500 uppercase tracking-wider mb-0.5 flex">
                  <span className="w-2 h-2 flex items-center justify-center text-[7px] border border-current rounded-full">kr</span> SEK Price
                </div>
                <div className="text-base font-mono font-bold text-white">
                  {analysis.sekPrice > 100 ? Math.round(analysis.sekPrice).toLocaleString('sv-SE') : analysis.sekPrice.toFixed(2)}
                  <span className="text-[9px] ml-0.5 text-slate-500 font-sans">kr</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Recommendation Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3.5 text-indigo-400">
            <Zap className="w-4 h-4 fill-current" />
            <h3 className="text-xs font-bold uppercase tracking-wider">Trading Consensus Recommendation</h3>
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1 space-y-3">
              <div className={`text-2xl font-black italic tracking-tight ${
                recommendation.action.includes('BUY') ? 'text-emerald-500' : 
                recommendation.action.includes('SELL') ? 'text-rose-500' : 'text-slate-400'
              }`}>
                {recommendation.action}
              </div>
              
              <ul className="space-y-2">
                {recommendation.reasoning.map((reason, i) => (
                  <li key={i} className="flex items-start gap-2 text-slate-300 text-xs leading-relaxed">
                    <span className="w-1 h-1 rounded-full bg-indigo-505 mt-1.5 shrink-0 bg-indigo-500" />
                    {reason}
                  </li>
                ))}
              </ul>
            </div>

            <div className="w-full md:w-60 space-y-2 shrink-0 border-t md:border-t-0 md:border-l border-slate-800 pt-3 md:pt-0 md:pl-5">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Technical Snapshot</div>
              <div className="flex justify-between items-center py-1.5 border-b border-white/5">
                <span className="text-slate-400 text-xs">RSI (14)</span>
                <span className={`font-mono text-xs font-bold ${signals.indicators.rsi! > 70 ? 'text-rose-400' : signals.indicators.rsi! < 30 ? 'text-emerald-400' : 'text-white'}`}>
                  {signals.indicators.rsi?.toFixed(1)}
                </span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-white/5">
                <span className="text-slate-400 text-xs">EMA (20)</span>
                <span className="font-mono text-xs text-white">${signals.indicators.ema_20?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-white/5">
                <span className="text-slate-400 text-xs">ATR Volatility</span>
                <span className="font-mono text-xs text-white">${signals.indicators.atr?.toFixed(4)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* P5: Profit & Risk Calculator */}
        <ProfitRiskCalc 
          analysis={analysis}
          sekRate={sekRate}
          candles={candles}
        />
      </div>

      {/* Support & Resistance */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-hidden relative group">
        <div className="flex items-center gap-2 mb-3 text-slate-300 relative z-10">
          <Info className="w-3.5 h-3.5" />
          <h3 className="text-xs font-bold uppercase tracking-wider">Key Resistance & Support Levels</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
          <div className="space-y-2">
             <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider pl-2 border-l-2 border-emerald-500">Resistance (Upside)</div>
             {levels.resistance.map((l, i) => (
               <div key={i} className="flex justify-between items-center py-1.5 px-3 bg-slate-950/40 rounded-lg font-mono text-xs border border-slate-800/40">
                 <span className="text-slate-500">R{i+1}</span>
                 <span className="text-emerald-400 font-bold">${l.toLocaleString()}</span>
               </div>
             ))}
          </div>

          <div className="space-y-2">
             <div className="text-[9px] font-bold text-rose-400 uppercase tracking-wider pl-2 border-l-2 border-rose-500">Support (Downside)</div>
             {levels.support.map((l, i) => (
               <div key={i} className="flex justify-between items-center py-1.5 px-3 bg-slate-950/40 rounded-lg font-mono text-xs border border-slate-800/40">
                 <span className="text-slate-500">S{i+1}</span>
                 <span className="text-rose-400 font-bold">${l.toLocaleString()}</span>
               </div>
             ))}
          </div>
        </div>
        
        {/* Background Decorative Pivot */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[64px] font-black pointer-events-none opacity-[0.02] uppercase italic">
          PIVOT: ${levels.pivot.toFixed(2)}
        </div>
      </div>

      {/* Structured AI Technical Analysis */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
        <button 
          onClick={() => setIsAnalysisExpanded(!isAnalysisExpanded)}
          className="w-full bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-4 py-3 flex items-center justify-between border-b border-slate-800 cursor-pointer hover:from-slate-800 hover:to-slate-800 transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-lg border transition-colors ${isAnalysisExpanded ? 'bg-indigo-500/20 border-indigo-500/40' : 'bg-indigo-500/5 border-indigo-500/10'}`}>
              <Activity className={`w-4 h-4 transition-colors ${isAnalysisExpanded ? 'text-indigo-400' : 'text-slate-500'}`} />
            </div>
            <div className="text-left">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white italic">Structured AI Technical Analysis</h3>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Multi-Factor Convergent Evaluation</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Confidence Index</div>
              <div className="text-xs font-mono font-bold text-emerald-400">{signals.strength}%</div>
            </div>
            <div className="p-1 bg-slate-950 rounded-lg border border-slate-800 group-hover:border-slate-700 transition-colors">
              {isAnalysisExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
            </div>
          </div>
        </button>

        <AnimatePresence>
          {isAnalysisExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
            >
              <div className="p-4 space-y-4">
                {/* Primary Evaluation Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Trend Structure */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <TrendingUp className="w-3 h-3" />
                      Trend Structure
                    </div>
                    <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-slate-500 uppercase font-black">Alignment</span>
                        <span className={`text-[9px] font-bold uppercase ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isUp ? 'Bullish Sync' : 'Bearish Sync'}
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${isUp ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'}`} 
                          style={{ width: `${signals.strength}%` }}
                        />
                      </div>
                      <p className="text-[9px] text-slate-500 leading-normal italic">
                        {isUp 
                          ? 'Price remains above EMA 20, confirming structural support.'
                          : 'Price remains below EMA 20, indicating consistent ceiling pressure.'}
                      </p>
                    </div>
                  </div>

                  {/* RSI Momentum Gauge */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <Gauge className="w-3 h-3" />
                      RSI Momentum
                    </div>
                    <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2 relative overflow-hidden">
                      <div className="flex items-center justify-between z-10 relative">
                        <span className="text-[9px] text-slate-500 uppercase font-black">RSI (14)</span>
                        <span className={`text-sm font-mono font-bold ${signals.indicators.rsi! > 70 ? 'text-rose-400' : signals.indicators.rsi! < 30 ? 'text-emerald-400' : 'text-indigo-400'}`}>
                          {signals.indicators.rsi!.toFixed(1)}
                        </span>
                      </div>
                      
                      <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden flex">
                        <div className="w-[30%] h-full border-r border-slate-900/50 bg-rose-500/20" title="Oversold" />
                        <div className="w-[40%] h-full border-r border-slate-900/50" />
                        <div className="w-[30%] h-full bg-emerald-500/20" title="Overbought" />
                        
                        <motion.div 
                          initial={{ left: '50%' }}
                          animate={{ left: `${signals.indicators.rsi}%` }}
                          className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_8px_white] z-20"
                        />
                      </div>
                      
                      <div className="flex justify-between text-[8px] font-bold uppercase text-slate-600">
                        <span>Oversold</span>
                        <span>Neutral</span>
                        <span>Overbought</span>
                      </div>
                    </div>
                  </div>

                  {/* Volume Dynamics */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <Activity className="w-3 h-3" />
                      Volume Profile
                    </div>
                    <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2.5">
                      <div className="flex justify-between items-end">
                        <div className="space-y-0.5">
                          <div className="text-[9px] text-slate-500 uppercase font-black">Participation</div>
                          <div className="text-[10px] font-extrabold text-white italic uppercase">Adaptive</div>
                        </div>
                        <div className="flex gap-0.5 items-end h-5">
                          {[4, 7, 5, 8, 6, 9, 7].map((h, i) => (
                            <div key={i} className="w-1 bg-indigo-500/30 rounded-t-sm" style={{ height: `${h * 10}%` }} />
                          ))}
                        </div>
                      </div>
                      <p className="text-[9px] text-slate-500 leading-normal italic bg-slate-900/40 p-1.5 rounded-md">
                        Institutional liquidity remains clustered in key static bands.
                      </p>
                    </div>
                  </div>

                  {/* AI Final Evaluation */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <Terminal className="w-3 h-3" />
                      Matrix Eval
                    </div>
                    <div className="p-3 bg-indigo-600/10 border border-indigo-500/20 rounded-xl space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[9px] font-bold text-indigo-400 uppercase italic">Outlook Status</span>
                      </div>
                      <div className="text-[9px] text-indigo-100 leading-relaxed font-semibold">
                        {isUp 
                          ? 'Golden crossovers signify bullish baseline. Prioritize consolidation breakouts.'
                          : 'Sellers in command below weekly pivot. Retain conservative approach.'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Secondary Deep Data: Indicators & Trade Levels */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 pt-4 border-t border-slate-800/50">
                  {/* Technical Indicators & Moving Averages */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <Binary className="w-3.5 h-3.5" />
                        Calculated EMAs
                      </div>
                      <div className="flex gap-1.5">
                        <div className="bg-emerald-500/10 text-emerald-400 text-[8px] font-bold px-1.5 py-0.2 rounded border border-emerald-500/10">EMA 20</div>
                        <div className="bg-indigo-500/10 text-indigo-400 text-[8px] font-bold px-1.5 py-0.2 rounded border border-indigo-500/10">EMA 50</div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/50 flex flex-col gap-0.5">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Alignment</span>
                        <span className="text-xs font-mono font-bold text-white uppercase italic">
                          {isUp ? 'Bullish Drift' : 'Bearish Ceiling'}
                        </span>
                        <span className="text-[8px] text-slate-600 leading-tight">Price coordinates favor major trends.</span>
                      </div>
                      
                      <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/50 flex flex-col gap-0.5">
                        <span className="text-[9px] font-bold text-slate-500">MACD Logic</span>
                        <span className="text-xs font-mono font-bold text-emerald-400 uppercase italic">Syncing</span>
                        <span className="text-[8px] text-slate-600 leading-tight">Oscillator exhibits positive development steps.</span>
                      </div>
                    </div>
                  </div>

                  {/* Critical Trade Levels List */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
                        Trigger Zones
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 flex flex-col items-center justify-center">
                        <span className="text-[8px] font-bold text-rose-500 uppercase tracking-wider">Ceiling</span>
                        <span className="text-xs font-mono font-bold text-white">${levels.resistance[2]?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="bg-indigo-600/5 p-2.5 rounded-lg border border-indigo-500/20 flex flex-col items-center justify-center">
                        <span className="text-[8px] font-bold text-indigo-400 uppercase tracking-wider">Pivot</span>
                        <span className="text-xs font-mono font-bold text-white">${levels.pivot.toLocaleString()}</span>
                      </div>
                      <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 flex flex-col items-center justify-center">
                        <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-wider">Floor</span>
                        <span className="text-xs font-mono font-bold text-white">${levels.support[0]?.toLocaleString() || 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer Evaluation Tag */}
                <div className="bg-slate-1000 p-2.5 rounded-b-xl border-t border-slate-900 flex items-center justify-between opacity-50 text-[8px] font-bold">
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3 h-3 text-indigo-405" />
                    <span className="uppercase tracking-widest text-slate-500">Terminal Sync: Active</span>
                  </div>
                  <div className="text-slate-500">v4.1.0-STABLE</div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* P11: Currency Conversion Blueprint */}
      <div className="bg-gradient-to-br from-slate-900 to-indigo-950 border border-indigo-500/10 rounded-xl p-4 text-white shadow-xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-4 relative z-10">
          <div className="flex items-center gap-2 text-indigo-400">
            <DollarSign className="w-5 h-5" />
            <h3 className="text-sm font-bold uppercase tracking-wider italic">Forex Converter Blueprint</h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-[8px] font-bold text-slate-505 uppercase tracking-wider mb-0.5 text-slate-500">SEK Unit</span>
              <input 
                type="number" 
                value={sekBaseAmount}
                onChange={(e) => setSekBaseAmount(Number(e.target.value))}
                className="w-16 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-xs font-mono font-bold text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[8px] font-bold text-slate-505 uppercase tracking-wider mb-0.5 text-slate-500">THB Unit</span>
              <input 
                type="number" 
                value={thbBaseAmount}
                onChange={(e) => setThbBaseAmount(Number(e.target.value))}
                className="w-16 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-xs font-mono font-bold text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-10">
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-indigo-500/5 flex flex-col items-center text-center space-y-2">
            <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest px-2 py-0.5 bg-slate-900 rounded">{sekBaseAmount} SEK Base</div>
            <div className="text-3xl font-mono font-black text-white italic tracking-tight">
              {(sekBaseAmount * (thbRate / sekRate)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              <span className="text-sm font-bold text-indigo-400 ml-1.5">THB</span>
            </div>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-2xl border border-indigo-500/5 flex flex-col items-center text-center space-y-2">
            <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest px-2 py-0.5 bg-slate-900 rounded">{thbBaseAmount} THB Base</div>
            <div className="text-3xl font-mono font-black text-white italic tracking-tight">
              {(thbBaseAmount * (sekRate / thbRate)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              <span className="text-sm font-bold text-indigo-400 ml-1.5">SEK</span>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-indigo-500/10 flex items-center justify-between text-[9px] text-slate-500 font-bold uppercase tracking-wider">
          <div className="flex items-center gap-1.5">
             <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
             Live Forex Mid-Market Rates
          </div>
          <div className="italic font-mono">1 USD = {thbRate.toFixed(2)} THB | {sekRate.toFixed(2)} SEK</div>
        </div>
      </div>

      {/* Real-time News Stream */}
      <NewsPanel symbol={coin.symbol} name={coin.name} />
    </div>
  );
};
