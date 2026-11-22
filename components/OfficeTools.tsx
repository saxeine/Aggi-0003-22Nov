import { AudioEngine } from '../services/customSpeech';
import ToolOrderSettingsModal from './ToolOrderSettingsModal';
import PodcastCreator from './PodcastCreator';
import PodcastResultView from './PodcastResultView';
import { computePodcastGate, buildStaggeredDefaultVoiceSettings, PodcastRole } from '../utils/podcastGating';
import React, { useState, useEffect } from 'react';
import { VoiceSettings, Session, MediaItem, PromptTemplate, CastMember } from '../types';
import PromptLibraryModal from './PromptLibraryModal';
import CastLibraryModal from './CastLibraryModal';
import { useLanguage } from '../contexts/LanguageContext';
import { Hero } from './CreationStudio/Hero';
import { InputArea } from './CreationStudio/InputArea';
import { LivePreview, Creation } from './CreationStudio/LivePreview';
import { CreationHistory } from './CreationStudio/CreationHistory';
import { AudioInput } from './AudioInput';
import { OfficeDatasheet } from './CreationStudio/OfficeDatasheet';
import { ImageCarverTool } from './CreationStudio/ImageCarverTool';
import { ProductResearchTool } from './CreationStudio/ProductResearchTool';
import { SocialMediaSuite } from './CreationStudio/SocialMediaSuite';
import { QuizAssessmentCreator } from './CreationStudio/QuizAssessmentCreator';
import { ExecutiveBriefing } from './CreationStudio/ExecutiveBriefing';
import { themeStyles, CREATIVE_STUDIO_THEMES } from '../constants/creativeStudioTheme';
import { Brainstormer } from './CreationStudio/Brainstormer';
import { EmailDrafter } from './CreationStudio/EmailDrafter';
import { MarketingCopywriter } from './CreationStudio/MarketingCopywriter';
import { SwotAnalysis } from './CreationStudio/SwotAnalysis';
import { CodeExplainer } from './CreationStudio/CodeExplainer';
import { EbookGenerator } from './CreationStudio/EbookGenerator';
import { WebsiteBuilder } from './CreationStudio/WebsiteBuilder';
import { TravelIntell } from './CreationStudio/TravelIntell';
import { CryptoTradingAssistant } from './crypto/CryptoTradingAssistant';
import { StockTradingAssistant } from './crypto/StockTradingAssistant';
import { CurrencyTradingAssistant } from './crypto/CurrencyTradingAssistant';
import { bringToLife, generateResponse } from '../services/gemini';
import { Upload } from 'lucide-react';
import RepoMergerView from './RepoMergerView';

interface OfficeToolsProps {
  onBack: () => void;
  voiceSettings: VoiceSettings;
  onUpdateVoiceSettings: (settings: VoiceSettings) => void;
  onRunTool: (toolId: string, payload?: any) => void;
  isLoading: boolean;
  hasActiveSession: boolean;
  session?: Session | null;
  sessions?: Session[];
  previewCode: string | null;
  onClosePreview: () => void;
  generatedAudio: string | null;
  onSaveAudio: (audioData: string, filename: string) => void;
  onLoadAudio?: (item: MediaItem) => void;
  onRemoveMediaItem?: (id: string) => void;
  onRenameMediaItem?: (id: string, name: string) => void;
  onRegenerate?: (newScript: string, engine: AudioEngine) => void;
  prompts: PromptTemplate[];
  onAddPrompt: (title: string, content: string) => void;
  onDeletePrompt: (id: string) => void;
  castLibrary: CastMember[];
  onAddCastMember: (member: Omit<CastMember, 'id'>) => void;
  onUpdateCastMember: (id: string, updates: Partial<CastMember>) => void;
  onDeleteCastMember: (id: string) => void;
  isCastLibraryOpen: boolean;
  setIsCastLibraryOpen: (isOpen: boolean) => void;
  touchedRoles?: PodcastRole[];
  setTouchedRoles?: React.Dispatch<React.SetStateAction<PodcastRole[]>>;
      onOpenMIPrOMPT?: () => void;
  miprompts?: any[];
  onAddMIPrOMPT?: (type: 'prB'|'ctB'|'txS', content: string, title?: string) => any;
  onUpdateMIPrOMPT?: (id: string, updates: any) => void;
  onDeleteMIPrOMPT?: (id: string) => void;
  initialBuilderData?: {type: 'prB' | 'ctB' | 'txS', content: string} | null;
  onClearInitialBuilderData?: () => void;
  currentTheme?: string;
  onSaveArtifact?: (item: MediaItem) => void;
}

const OfficeTools: React.FC<OfficeToolsProps> = ({
  onBack,
  currentTheme,
  voiceSettings,
  onUpdateVoiceSettings,
  onRunTool,
  isLoading,
  hasActiveSession,
  session,
  sessions = [],
  previewCode,
  onClosePreview,
  generatedAudio,
  onSaveAudio,
  onLoadAudio,
  onRemoveMediaItem,
  onRenameMediaItem,
  onRegenerate,
  prompts,
  onAddPrompt,
  onDeletePrompt,
  castLibrary,
  onAddCastMember,
  onUpdateCastMember,
  onDeleteCastMember,
  isCastLibraryOpen,
  setIsCastLibraryOpen,
  touchedRoles: propTouchedRoles,
  setTouchedRoles: propSetTouchedRoles,
      onOpenMIPrOMPT,
  miprompts = [],
  onAddMIPrOMPT,
  onUpdateMIPrOMPT,
  onDeleteMIPrOMPT,
  initialBuilderData,
  onClearInitialBuilderData,
  onSaveArtifact
}) => {
  const { t } = useLanguage();
  const [localTheme, setLocalTheme] = useState<'charcoal' | 'silver' | 'white' | 'cosmic' | 'emerald' | 'amber' | 'cyberpunk' | 'slate' | 'crimson' | 'orchid' | 'olive'>(() => {
    const saved = localStorage.getItem('creative_studio_theme') as any;
    const allowed = CREATIVE_STUDIO_THEMES;
    if (saved && allowed.includes(saved)) {
      return saved;
    }
    return 'charcoal';
  });

  useEffect(() => {
    const handleThemeChange = () => {
      const saved = localStorage.getItem('creative_studio_theme') as any;
      const allowed = CREATIVE_STUDIO_THEMES;
      if (saved && allowed.includes(saved)) {
        setLocalTheme(saved);
      }
    };
    window.addEventListener('creative_studio_theme_change', handleThemeChange);
    return () => {
      window.removeEventListener('creative_studio_theme_change', handleThemeChange);
    };
  }, []);

  const st = themeStyles[localTheme];

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [globalPodcastHistory, setGlobalPodcastHistory] = useState<MediaItem[]>([]);

  useEffect(() => {
    const loadGlobalHistory = () => {
      try {
        const saved = localStorage.getItem('global_podcast_history');
        if (saved) {
          setGlobalPodcastHistory(JSON.parse(saved));
        } else {
          setGlobalPodcastHistory([]);
        }
      } catch (err) {
        console.error("Failed to load global podcast history:", err);
      }
    };

    loadGlobalHistory();
    window.addEventListener('global_podcast_history_updated', loadGlobalHistory);
    return () => {
      window.removeEventListener('global_podcast_history_updated', loadGlobalHistory);
    };
  }, []);

  const [editItemName, setEditItemName] = useState('');
  const [showPrompts, setShowPrompts] = useState(false);

  // Bring Anything To Life State
  const [bringToLifeHistory, setBringToLifeHistory] = useState<Creation[]>([]);
  const [activeCreation, setActiveCreation] = useState<Creation | null>(null);
  const [isGeneratingCreation, setIsGeneratingCreation] = useState(false);
  const [isCreationFocused, setIsCreationFocused] = useState(false);

  // Load Bring Anything To Life History
  useEffect(() => {
    const saved = localStorage.getItem('bring_to_life_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setBringToLifeHistory(parsed.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp)
        })));
      } catch (e) {
        console.error("Failed to load Bring Anything To Life history", e);
      }
    }
  }, []);

  // Save Bring Anything To Life History
  useEffect(() => {
    localStorage.setItem('bring_to_life_history', JSON.stringify(bringToLifeHistory));
  }, [bringToLifeHistory]);

  // Controlled PodcastCreator topic & session context state
  const [podcastCustomInput, setPodcastCustomInput] = useState('');
  const [podcastIncludeSessionData, setPodcastIncludeSessionData] = useState(hasActiveSession);

  useEffect(() => {
    setPodcastIncludeSessionData(hasActiveSession);
  }, [hasActiveSession]);

  // YouTube Transcript State
  const [ytLink, setYtLink] = useState('');
  const [ytFile, setYtFile] = useState<File | null>(null);
  const [ytDuration, setYtDuration] = useState('All');

  const [summaryText, setSummaryText] = useState('');
  const [summaryFile, setSummaryFile] = useState<File | null>(null);
  const [summaryAction, setSummaryAction] = useState('summarize');
  const [summaryLang, setSummaryLang] = useState('swedish');

  // Independent Builder States
  const [builderInput, setBuilderInput] = useState('');
  const [builderSessionId, setBuilderSessionId] = useState<string>('none');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const [builderProductType, setBuilderProductType] = useState('Online Course');
  const [builderNiche, setBuilderNiche] = useState('Food & Beverage');
  const [builderSkillLevel, setBuilderSkillLevel] = useState('');
  const [builderPrimaryGoal, setBuilderPrimaryGoal] = useState('Education / Training');
  const [builderSellingPlatform, setBuilderSellingPlatform] = useState('Own Website');
  const [builderColorScheme, setBuilderColorScheme] = useState('Clean Minimalist');
  const [builderPromotionStrategy, setBuilderPromotionStrategy] = useState('Influencer Sponsorships');
  const [builderStep, setBuilderStep] = useState<1 | 2>(1);
  const [showAdvancedTemplates, setShowAdvancedTemplates] = useState(false);
  const [greyedConfigs, setGreyedConfigs] = useState<string[]>([]);
  const [selectedCrypto, setSelectedCrypto] = useState('XRP');

  // mIPrOMPT search and filter states
  const [mipromptSearch, setMipromptSearch] = useState('');
  const [mipromptFilter, setMipromptFilter] = useState<'all' | 'prB' | 'ctB' | 'txS'>('all');
  const [copiedMipromptId, setCopiedMipromptId] = useState<string | null>(null);

  // Spreadsheet Creator Presets and States
  const SHEET_TEMPLATES = {
    budget: {
      name: 'Monthly Budget Tracker',
      columns: ['Date', 'Category', 'Description', 'Income', 'Expense', 'Balance'],
      rowGen: (i: number) => {
        const cats = ['Salary', 'Rent', 'Groceries', 'Utilities', 'Subscriptions', 'Transport', 'Savings', 'Dining out'];
        const cat = cats[i % cats.length];
        const income = cat === 'Salary' ? (3000 + (i % 3) * 150) : 0;
        const expense = cat === 'Salary' ? 0 : (40 + (i * 17) % 260);
        const balance = 1000 + income - expense + (i * 23 % 400);
        const date = new Date(2026, 0, 1 + i);
        return [date.toISOString().slice(0,10), cat, `${cat} entry ${i+1}`, income ? `$${income}` : '$0', expense ? `$${expense}` : '$0', `$${balance}`];
      }
    },
    content: {
      name: 'Content Calendar',
      columns: ['Date', 'Platform', 'Content type', 'Title', 'Status', 'Notes'],
      rowGen: (i: number) => {
        const platforms = ['Instagram', 'YouTube', 'TikTok', 'Blog', 'Newsletter', 'X'];
        const types = ['Reel', 'Carousel', 'Short', 'Article', 'Email', 'Thread'];
        const statuses = ['Idea', 'Drafting', 'In review', 'Scheduled', 'Published'];
        const date = new Date(2026, 0, 1 + i * 2);
        return [date.toISOString().slice(0,10), platforms[i % platforms.length], types[i % types.length], `Post idea #${i+1}`, statuses[i % statuses.length], 'Auto-generated placeholder'];
      }
    },
    habit: {
      name: 'Habit Tracker',
      columns: ['Habit', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Streak'],
      rowGen: (i: number) => {
        const habits = ['Drink water', 'Exercise', 'Read 20 min', 'Meditate', 'Journal', 'No sugar', 'Walk 8k steps', 'Sleep by 11pm', 'Stretch', 'Plan tomorrow'];
        const mark = () => (Math.random() > 0.35 ? '✓' : '–');
        const row = [habits[i % habits.length]];
        for (let d = 0; d < 7; d++) row.push(mark());
        row.push(String((i * 3) % 14));
        return row;
      }
    },
    invoice: {
      name: 'Invoice Template',
      columns: ['Item', 'Description', 'Quantity', 'Unit price', 'Total'],
      rowGen: (i: number) => {
        const items = ['Design service', 'Consulting hour', 'Website template', 'Logo package', 'Social media kit', 'SEO audit', 'Copywriting', 'Video edit'];
        const qty = 1 + (i % 4);
        const price = 25 + (i * 15) % 200;
        return [items[i % items.length], `${items[i % items.length]} - item ${i+1}`, String(qty), `$${price}`, `$${qty * price}`];
      }
    },
    crm: {
      name: 'Client CRM',
      columns: ['Name', 'Email', 'Phone', 'Status', 'Last contact', 'Notes'],
      rowGen: (i: number) => {
        const names = ['Alex Carter', 'Priya Shah', 'Jordan Lee', 'Maria Gomez', 'Sam Patel', 'Chris Nguyen', 'Taylor Brooks', 'Jamie Reyes'];
        const statuses = ['Lead', 'Contacted', 'Proposal sent', 'Negotiating', 'Won', 'Lost'];
        const name = names[i % names.length];
        const email = name.toLowerCase().replace(' ', '.') + '@example.com';
        const date = new Date(2026, 0, 1 + i * 3);
        return [name, email, `+1 555-01${String(10 + i).padStart(2,'0')}`, statuses[i % statuses.length], date.toISOString().slice(0,10), 'Auto-generated placeholder'];
      }
    },
    meal: {
      name: 'Weekly Meal Planner',
      columns: ['Day', 'Breakfast', 'Lunch', 'Dinner', 'Snacks'],
      rowGen: (i: number) => {
        const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
        const b = ['Oatmeal & berries','Greek yogurt','Avocado toast','Smoothie','Eggs & toast','Pancakes','Fruit bowl'];
        const l = ['Chicken salad','Veggie wrap','Quinoa bowl','Soup & bread','Sushi','Pasta salad','Grilled cheese'];
        const d = ['Salmon & veggies','Stir fry','Tacos','Lentil curry','Pizza night','Roast chicken','Pasta'];
        const s = ['Almonds','Fruit','Hummus & veg','Yogurt','Trail mix','Popcorn','Crackers'];
        const idx = i % 7;
        return [days[idx], b[idx], l[idx], d[idx], s[idx]];
      }
    }
  };

  const [sheetName, setSheetName] = useState('Monthly Budget Tracker');
  const [sheetRows, setSheetRows] = useState(10);
  const [sheetTemplate, setSheetTemplate] = useState('budget');
  const [useSessionData, setUseSessionData] = useState(false);
  const [sheetCustomPrompt, setSheetCustomPrompt] = useState('');
  const [isGeneratingSheet, setIsGeneratingSheet] = useState(false);
  const [spreadsheetResult, setSpreadsheetResult] = useState<{ columns: string[], rows: any[][], sheetName: string } | null>(null);
  const [sheetSearch, setSheetSearch] = useState('');

  const handleGenerateSpreadsheet = async () => {
    setIsGeneratingSheet(true);
    setSpreadsheetResult(null);

    try {
      const activeMediaItems = (useSessionData && session) ? session.mediaItems.filter(item => 
        session.selectedMediaIds.includes(item.id)
      ) : [];

      // If they want to use session data OR they have a custom prompt instruction
      if (useSessionData || sheetCustomPrompt.trim()) {
        const sysPrompt = `You are an expert Data Analyst and spreadsheet model builder.
Analyze the request and build a structured spreadsheet (columns and rows) containing realistic and useful data.
User Instructions: ${sheetCustomPrompt || `Generate a spreadsheet using the ${sheetTemplate} template.`}
Spreadsheet Name: ${sheetName}
Number of Rows to generate: ${sheetRows}

You MUST return ONLY a valid raw JSON object matching the following TypeScript schema. Do NOT wrap it in markdown code blocks like \`\`\`json, do NOT include any other text or explanation:
{
  "sheetName": "Descriptive Spreadsheet Name",
  "columns": ["Col1", "Col2", "Col3", ...],
  "rows": [
    ["cell1a", "cell1b", "cell1c", ...],
    ["cell2a", "cell2b", "cell2c", ...],
    ...
  ]
}`;

        const result = await generateResponse(sysPrompt, [], activeMediaItems, 'gemini-3.8-flash');
        let cleanText = result.text.trim();
        const codeBlockMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
            cleanText = codeBlockMatch[1].trim();
        }
        
        try {
          const parsed = JSON.parse(cleanText);
          if (parsed && Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) {
            setSpreadsheetResult({
              sheetName: parsed.sheetName || sheetName,
              columns: parsed.columns,
              rows: parsed.rows
            });
            setIsGeneratingSheet(false);
            return;
          }
        } catch (jsonErr) {
          console.warn("JSON parsing of AI output failed, falling back to structured list parser", jsonErr);
        }
      }

      // Offline fallback / Standard Template Generation
      const template = SHEET_TEMPLATES[sheetTemplate as keyof typeof SHEET_TEMPLATES] || SHEET_TEMPLATES.budget;
      const cols = template.columns;
      const rows = [];
      for (let i = 0; i < sheetRows; i++) {
        rows.push(template.rowGen(i));
      }
      setSpreadsheetResult({
        sheetName: sheetName || template.name,
        columns: cols,
        rows: rows
      });

    } catch (err) {
      console.error("Spreadsheet generation failed", err);
      alert("Error generating spreadsheet. Falling back to local template.");
      const template = SHEET_TEMPLATES[sheetTemplate as keyof typeof SHEET_TEMPLATES] || SHEET_TEMPLATES.budget;
      const cols = template.columns;
      const rows = [];
      for (let i = 0; i < sheetRows; i++) {
        rows.push(template.rowGen(i));
      }
      setSpreadsheetResult({
        sheetName: sheetName || template.name,
        columns: cols,
        rows: rows
      });
    } finally {
      setIsGeneratingSheet(false);
    }
  };

  const downloadCSV = () => {
    if (!spreadsheetResult) return;
    const { columns, rows, sheetName: name } = spreadsheetResult;

    const escapeCsv = (val: any) => {
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    let csv = columns.map(escapeCsv).join(',') + '\n';
    rows.forEach(row => {
      csv += row.map(escapeCsv).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = (name || 'spreadsheet').trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv';
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  const importInputRef = React.useRef<HTMLInputElement>(null);

  const productTypePresets = ['Online Course', 'E-Book / Guide', 'Membership Site', 'SaaS Software', 'Physical Product', 'Consulting / Coaching'];
  const nichePresets = ['Health & Fitness', 'Personal Finance', 'Digital Marketing', 'Technology / SaaS', 'Self-Improvement', 'Real Estate', 'Food & Beverage', 'Travel & Lifestyle', 'Fashion & Apparel', 'Gaming & Esports', 'Education', 'Pet Care'];
  const skillLevelPresets = ['Absolute Beginner', 'Intermediate', 'Advanced', 'Expert / Professional', 'All Levels', 'Corporate / Enterprise'];
  const primaryGoalPresets = ['Lead Generation', 'Direct Sales', 'Brand Awareness', 'Audience Onboarding', 'Customer Retention', 'Education / Training'];
  const sellingPlatformPresets = ['Shopify', 'Amazon FBA', 'WooCommerce', 'ClickFunnels', 'Gumroad', 'Own Website'];
  const colorSchemePresets = ['Dark Mode & Neon', 'Clean Minimalist', 'Pastel & Playful', 'Earthy & Natural', 'High Contrast', 'Corporate Blue', 'Cyberpunk', 'Retro Vaporwave', 'Neumorphic Light', 'Monochrome & Serif', 'Vibrant Gradients', 'Midnight Purple'];
  const promotionStrategyPresets = ['Meta / Facebook Ads', 'Organic SEO', 'TikTok Video', 'Email Marketing', 'Influencer Sponsorships', 'Affiliate Program'];

  const advancedTemplatesArray = [
      { id: 'adv_inv', name: 'Invoice generator', prompt: 'Build an interactive Invoice Generator that allows users to add items, calculate totals, and print or export the invoice.', isCustom: false },
      { id: 'adv_cap', name: 'Caption / text writer', prompt: 'Act as a professional copywriter and generate engaging captions and text variations for social media.', isCustom: false },
      { id: 'adv_tax', name: 'Tax Calculator', prompt: 'Build an interactive Tax Calculator that takes income and deductions to calculate estimated tax.', isCustom: false },
      { id: 'adv_form', name: 'Form or app helper', prompt: 'Build a multi-step form or application helper with validation and progress tracking.', isCustom: false },
      { id: 'adv_roi', name: 'ROI Calculator', prompt: 'Build an engaging ROI Calculator where users input costs and returns to visualize their profit margins.', isCustom: false },
      { id: 'adv_prod', name: 'Offer / product desc', prompt: 'Act as a direct-response marketer and generate a compelling offer or product description.', isCustom: false },
      { id: 'adv_doc', name: 'Doc / text summariser', prompt: 'Build a text summarization tool where users can paste long documents to get concise bulleted summaries.', isCustom: false }
  ];

  let promptTemplates = [
      { id: 'p_eng', name: 'Software Engineer', prompt: 'Act as a Senior Software Engineer. Provide complete, maintainable, and well-documented code.' },
      { id: 'p_copy', name: 'SEO Copywriter', prompt: 'Act as an expert SEO Copywriter. Produce high-converting, keyword-optimized content.' },
      { id: 'p_pm', name: 'Project Manager', prompt: 'Act as an Agile Project Manager. Help break down tasks, write Jira tickets, and plan sprints.' },
      { id: 'p_data', name: 'Data Analyst', prompt: 'Act as a Data Analyst. Write optimized SQL queries and explain complex data trends clearly.' },
      { id: 'p_creative', name: 'Creative Director', prompt: 'Act as a Creative Director. Provide bold, innovative design ideas and brand strategies.' },
      { id: 'p_tutor', name: 'Expert Tutor', prompt: 'Act as an Expert Tutor. Explain concepts using analogies, step-by-step logic, and check for understanding.' },
      ...(miprompts?.filter(p => p.type === 'prB').map(p => ({ id: p.id, name: p.name.split('-').pop() || p.name, prompt: p.content, isCustom: true })) || [])
  ];

  let contentTemplates = [
      { id: 'c_food', name: 'Food Planner App', prompt: 'Create a comprehensive weekly food planner component. It should include a 7-day grid showing Breakfast, Lunch, and Dinner. Add drag-and-drop support for meals, and a sidebar with a shopping list summary. Use React and Tailwind CSS.' },
      { id: 'c_landing', name: 'SaaS Landing Page', prompt: 'Build a modern SaaS landing page with a hero section, feature grid, testimonials, and a pricing table.' },
      { id: 'c_portfolio', name: 'Personal Portfolio', prompt: 'Build a sleek personal portfolio for a creative professional with a gallery, about section, and contact form.' },
      { id: 'c_ecommerce', name: 'E-commerce Store', prompt: 'Build an e-commerce storefront with a product grid, shopping cart sidebar, and promotional banner.' },
      { id: 'c_blog', name: 'Blog Magazine', prompt: 'Build a news/blog layout with a featured article section, recent posts grid, and a sidebar for categories.' },
      { id: 'c_dashboard', name: 'Admin Dashboard', prompt: 'Build an admin dashboard with a side navigation menu, top header, status cards, and a data table.' },
      { id: 'c_event', name: 'Event Page', prompt: 'Build an event registration page detailing schedule, speakers, location map placeholder, and a ticket form.' },
      ...(miprompts?.filter(p => p.type === 'ctB').map(p => ({ id: p.id, name: p.name.split('-').pop() || p.name, prompt: p.content, isCustom: true })) || [])
  ];

  if (showAdvancedTemplates) {
      promptTemplates = [...promptTemplates, ...advancedTemplatesArray.filter(t => ['adv_cap', 'adv_prod'].includes(t.id))];
      contentTemplates = [...contentTemplates, ...advancedTemplatesArray.filter(t => !['adv_cap', 'adv_prod'].includes(t.id))];
  }

  useEffect(() => {
      if (activeTool === 'content_builder' && !builderInput) {
          const foodPlannerTemplate = contentTemplates.find(t => t.id === 'c_food');
          if (foodPlannerTemplate) {
              setBuilderInput(foodPlannerTemplate.prompt);
              setSelectedTemplate('c_food');
          }
      }
  }, [activeTool]);

  const handleIndependentBuilderGenerate = (toolId: string) => {
      if (!builderInput && builderSessionId === 'none') {
          alert('Please provide instructions/topic or include data from a session.');
          return;
      }
      onRunTool(toolId, { 
          instruction: builderInput, 
          builderSessionId: builderSessionId === 'none' ? undefined : builderSessionId, 
          isIndependent: true,
          productType: greyedConfigs.includes('product') ? '' : builderProductType,
          niche: greyedConfigs.includes('niche') ? '' : builderNiche,
          skillLevel: greyedConfigs.includes('skill') ? '' : builderSkillLevel,
          primaryGoal: greyedConfigs.includes('goal') ? '' : builderPrimaryGoal,
          sellingPlatform: greyedConfigs.includes('platform') ? '' : builderSellingPlatform,
          colorScheme: greyedConfigs.includes('color') ? '' : builderColorScheme,
          promotionStrategy: greyedConfigs.includes('promotion') ? '' : builderPromotionStrategy
      });
  };

  useEffect(() => {
    // Reset step when tool changes
    setBuilderStep(1);
  }, [activeTool]);

  useEffect(() => {
    if (initialBuilderData) {
      if (initialBuilderData.type === 'prB') {
        setActiveTool('prompt_builder');
      } else if (initialBuilderData.type === 'ctB') {
        setActiveTool('content_builder');
      } else if (initialBuilderData.type === 'txS') {
        setActiveTool('text_summarizer');
      }
      setBuilderInput(initialBuilderData.content);
      setSelectedTemplate(null);
      if (onClearInitialBuilderData) {
        onClearInitialBuilderData();
      }
    }
  }, [initialBuilderData, onClearInitialBuilderData]);

  const handleGenerateTranscript = () => {
      if (!ytLink && !ytFile) {
          alert("Please provide a YouTube link or upload a video or audio file.");
          return;
      }
      
      if (ytFile) {
          if (ytFile.size > 19 * 1024 * 1024) {
              alert("File is too large for direct upload (max 19MB). Please use a YouTube link instead.");
              return;
          }
          const reader = new FileReader();
          reader.onload = (e) => {
              const result = e.target?.result as string;
              const base64Data = result.split(',')[1];
              const mediaItem: MediaItem = {
                  id: Math.random().toString(36).substring(7),
                  name: ytFile.name,
                  type: ytFile.type.startsWith('audio/') ? 'audio' : 'video',
                  mimeType: ytFile.type,
                  data: base64Data
              };
              onRunTool('youtube_transcript', { mediaItem, duration: ytDuration });
          };
          reader.readAsDataURL(ytFile);
      } else {
          const mediaItem: MediaItem = {
              id: Math.random().toString(36).substring(7),
              name: ytLink,
              type: 'link',
              mimeType: 'text/uri-list',
              data: ytLink
          };
          onRunTool('youtube_transcript', { mediaItem, duration: ytDuration });
      }
  };

  const handleGenerateSummary = () => {
      if (!summaryText && !summaryFile) {
          alert("Please provide text or upload a file.");
          return;
      }
      
      if (summaryFile) {
          const reader = new FileReader();
          reader.onload = (e) => {
              const result = e.target?.result as string;
              const base64Data = result.split(',')[1];
              const mediaItem: MediaItem = {
                  id: Math.random().toString(36).substring(7),
                  name: summaryFile.name,
                  type: 'document',
                  mimeType: summaryFile.type || 'text/plain',
                  data: base64Data
              };
              onRunTool('text_summarizer', { mediaItem, action: summaryAction, lang: summaryLang });
          };
          reader.readAsDataURL(summaryFile);
      } else {
          const mediaItem: MediaItem = {
              id: Math.random().toString(36).substring(7),
              name: 'Pasted Text',
              type: 'text',
              mimeType: 'text/plain',
              data: btoa(unescape(encodeURIComponent(summaryText)))
          };
          onRunTool('text_summarizer', { mediaItem, action: summaryAction, lang: summaryLang });
      }
  };

  // Track active format. Starts as null: the creator gate requires an explicit
  // format pick before any podcast is produced.
  const [activeFormat, setActiveFormat] = useState<'podcast_1' | 'podcast_2' | 'podcast_3' | null>(null);

  // Roles the user explicitly configured (cast member picked / display name / avatar).
  // Shared with App.tsx, MediaPanel, and the player header so gating is consistent everywhere.
  const [localTouchedRoles, setLocalTouchedRoles] = useState<PodcastRole[]>([]);
  const touchedRoles = propTouchedRoles ?? localTouchedRoles;
  const setTouchedRoles = propSetTouchedRoles ?? setLocalTouchedRoles;

  const runFormat = (format: 'podcast_1' | 'podcast_2' | 'podcast_3', lengthOverride?: VoiceSettings['length']) => {
      setActiveFormat(format);
      const gate = computePodcastGate({
          touchedRoles,
          activeFormat: format,
          contentReady: true,
          isLoading: false,
      });
      // Only the speaker in position one (host) is used when more than one
      // speaker is configured or a required speaker is missing.
      onRunTool(format, {
          isIndependent: true,
          customInput: podcastCustomInput,
          includeSessionData: hasActiveSession && podcastIncludeSessionData,
          length: lengthOverride ?? voiceSettings.length,
          hostOnly: gate.hostOnly,
          speakerCount: gate.speakerCount,
      });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        } else {
          reject(new Error('Failed to convert file to base64'));
        }
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleGenerateCreation = async (promptText: string, file?: File) => {
    setIsGeneratingCreation(true);
    setIsCreationFocused(true);
    setActiveCreation(null);

    try {
      let imageBase64: string | undefined;
      let mimeType: string | undefined;

      if (file) {
        imageBase64 = await fileToBase64(file);
        mimeType = file.type.toLowerCase();
      }

      const html = await bringToLife(promptText, imageBase64, mimeType);
      
      if (html) {
        const newCreation: Creation = {
          id: Math.random().toString(36).substring(7),
          name: file ? file.name : (promptText.substring(0, 20) || 'New Creation'),
          html: html,
          originalImage: imageBase64 && mimeType ? `data:${mimeType};base64,${imageBase64}` : undefined,
          timestamp: new Date(),
        };
        setActiveCreation(newCreation);
        setBringToLifeHistory(prev => [newCreation, ...prev]);
      }

    } catch (error: any) {
      console.error("Failed to generate:", error);
      alert(error.message || "An unexpected error occurred. Please try again.");
      setIsCreationFocused(false);
    } finally {
      setIsGeneratingCreation(false);
    }
  };

  const handleSelectCreation = (creation: Creation) => {
    setActiveCreation(creation);
    setIsCreationFocused(true);
  };

  const handleDeleteCreation = (id: string) => {
    setBringToLifeHistory(prev => prev.filter(c => c.id !== id));
    if (activeCreation && activeCreation.id === id) {
      handleResetCreation();
    }
  };

  const handleEditCreation = (id: string, newName: string) => {
    setBringToLifeHistory(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c));
    if (activeCreation && activeCreation.id === id) {
      setActiveCreation(prev => prev ? { ...prev, name: newName } : null);
    }
  };

  const handleResetCreation = () => {
    setActiveCreation(null);
    setIsGeneratingCreation(false);
    setIsCreationFocused(false);
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const json = event.target?.result as string;
            const parsed = JSON.parse(json);
            
            if (parsed.html && parsed.name) {
                const importedCreation: Creation = {
                    ...parsed,
                    timestamp: new Date(parsed.timestamp || Date.now()),
                    id: parsed.id || Math.random().toString(36).substring(7)
                };
                
                setBringToLifeHistory(prev => {
                    const exists = prev.some(c => c.id === importedCreation.id);
                    return exists ? prev : [importedCreation, ...prev];
                });

                setActiveCreation(importedCreation);
                setIsCreationFocused(true);
            } else {
                alert("Invalid creation file format.");
            }
        } catch (err) {
            console.error("Import error", err);
            alert("Failed to import creation.");
        }
        if (importInputRef.current) importInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleHistoryItemClick = (item: MediaItem) => {
      if (onLoadAudio) {
          onLoadAudio(item);
          setShowHistory(false);
          // We need to switch to player view if not already there?
          // Actually, generatedAudio change will trigger useEffect, but we need to show the player.
          // The player is shown when `previewCode` is truthy OR `generatedAudio` is truthy?
          // Wait, `StudioView` returns early if `previewCode` is truthy.
          // But `generatedAudio` is used inside that block.
          // If `previewCode` is null, we are in the tool selection view.
          // So we need to set `previewCode` to something to show the player view.
          // Or we can just show the player in the main view if audio is loaded.
          // But the current design only shows player if `previewCode` is set (line 147).
          // We should probably set a dummy previewCode or modify the condition.
          // Let's set a dummy previewCode.
          // But `previewCode` is passed from parent. We cannot set it directly.
          // We need a callback to set previewCode in parent.
          // `onRunTool` sets previewCode in parent.
          // Maybe we can trigger a "load audio" tool action?
          // Or just modify the condition in `StudioView` to show player if `generatedAudio` is present?
          // But `generatedAudio` is present even when we go back to library? No, it's state in App.tsx.
          // If we load audio, we want to see the player.
          // Let's assume the user is already in the player view? No, they are in the creator view.
          // If they click history, they want to listen to it.
          // The player is inside the `if (previewCode)` block.
          // This is a problem. The player is coupled with the preview code.
          // I should probably move the player out or duplicate it, or force previewCode to be set.
          // But `previewCode` is for the script. The history item doesn't have the script (unless we saved it).
          // If we just want to play audio, we might need a standalone player or reuse the existing one.
          // The existing one is nice.
          // Let's see if we can trigger `onRunTool` with a special type that sets previewCode to a placeholder?
          // Or just modify `App.tsx` to set `previewCode` when audio is loaded?
          // But `onLoadAudio` is in `App.tsx`.
          // Let's modify `onLoadAudio` in `App.tsx` to also set `previewCode`.
          // But I already modified `App.tsx`. I don't want to modify it again if I can avoid it.
          // Wait, `StudioView` has `onClosePreview`.
          // If I change `if (previewCode)` to `if (previewCode || generatedAudio)`, then I can show the player.
          // But `ArtifactPreview` needs `code`.
          // If `previewCode` is null, `ArtifactPreview` will crash or show nothing.
          // Let's check `ArtifactPreview`.
          // It takes `code` prop.
          // If I change the condition, I need to handle `previewCode` being null.
          
          // Alternative: The History button is in the Creator view (when `previewCode` is null).
          // When clicked, it loads audio.
          // If I load audio, I want to see the player.
          // So I need to transition to the player view.
          // The player view is controlled by `previewCode` in `App.tsx`.
          // I should have updated `onLoadAudio` in `App.tsx` to set `previewCode` to "Audio Only" or something.
          
          // Let's modify `App.tsx` again to set `previewCode` when loading audio.
          // This is the cleanest way to reuse the existing player UI.
      }
  };

  if (previewCode) {
      return (
          <PodcastResultView
              previewCode={previewCode}
              onClosePreview={onClosePreview}
              generatedAudio={generatedAudio}
              onSaveAudio={onSaveAudio}
              onRegenerate={onRegenerate}
              isLoading={isLoading}
              activeTool={activeTool}
              activeFormat={activeFormat}
              touchedRoles={touchedRoles}
              voiceSettings={voiceSettings}
              onUpdateVoiceSettings={onUpdateVoiceSettings}
              onRunFormat={runFormat}
              currentTheme={currentTheme}
          />
      );
  }

  const tools = [
    {
      id: 'travel_intell',
      title: 'Travel Intelligence',
      description: 'Aggregate and analyze multi-platform travel intelligence, price trends, and customer sentiment.',
      icon: (
        <svg className="w-8 h-8 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 002 2h1.5a2.5 2.5 0 012.5 2.5V14m-12.5 5h1a2 2 0 002-2v-1a2 2 0 00-2-2H3m14 3h2a2 2 0 002-2v-1a2 2 0 00-2-2h-1m-1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'bg-sky-500/10 border-sky-500/30 hover:border-sky-500',
      disabled: false
    },
    {
      id: 'social_generator',
      title: 'Social Media Suite',
      description: 'Generate viral posts for LinkedIn, X (Twitter), and Instagram.',
      icon: (
        <svg className="w-8 h-8 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
      ),
      color: 'bg-pink-500/10 border-pink-500/30 hover:border-pink-500',
      disabled: !hasActiveSession
    },
    {
      id: 'quiz_creator',
      title: 'Quiz & Assessment',
      description: 'Generate interactive quizzes and flashcards from your sources.',
      icon: (
        <svg className="w-8 h-8 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'bg-yellow-500/10 border-yellow-500/30 hover:border-yellow-500',
      disabled: !hasActiveSession
    },
    {
      id: 'exec_briefing',
      title: 'Executive Briefing',
      description: 'A high-level, one-page strategic overview for decision makers.',
      icon: (
        <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      color: 'bg-indigo-500/10 border-indigo-500/30 hover:border-indigo-500',
      disabled: !hasActiveSession
    },
    {
      id: 'brainstormer',
      title: 'Creative Brainstorm',
      description: 'Generate 10 "wild" ideas and unconventional perspectives.',
      icon: (
        <svg className="w-8 h-8 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
      color: 'bg-orange-500/10 border-orange-500/30 hover:border-orange-500',
      disabled: !hasActiveSession
    },
    {
      id: 'email_drafter',
      title: 'Email Drafter',
      description: 'Draft professional, persuasive, or casual emails based on your sources.',
      icon: (
        <svg className="w-8 h-8 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      color: 'bg-cyan-500/10 border-cyan-500/30 hover:border-cyan-500',
      disabled: !hasActiveSession
    },
    {
      id: 'marketing_copy',
      title: 'Marketing Copywriter',
      description: 'Generate high-converting ad copy, headlines, and product descriptions.',
      icon: (
        <svg className="w-8 h-8 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
      ),
      color: 'bg-rose-500/10 border-rose-500/30 hover:border-rose-500',
      disabled: !hasActiveSession
    },
    {
      id: 'swot_analysis',
      title: 'SWOT Analysis',
      description: 'Perform a strategic Strengths, Weaknesses, Opportunities, and Threats analysis.',
      icon: (
        <svg className="w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      color: 'bg-violet-500/10 border-violet-500/30 hover:border-violet-500',
      disabled: !hasActiveSession
    },
    {
      id: 'code_explainer',
      title: 'Code Explainer',
      description: 'Break down complex code snippets into simple, easy-to-understand English.',
      icon: (
        <svg className="w-8 h-8 text-lime-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      ),
      color: 'bg-lime-500/10 border-lime-500/30 hover:border-lime-500',
      disabled: !hasActiveSession
    },
    {
      id: 'ebook_generator',
      title: 'Ebook Generator',
      description: 'Draft outlines and chapters for a comprehensive E-Book.',
      icon: (
        <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
      color: 'bg-indigo-500/10 border-indigo-500/30 hover:border-indigo-500',
      disabled: !hasActiveSession
    },
    {
      id: 'spreadsheet_creator',
      title: 'Spreadsheet Creator',
      description: 'Format data into templates with formulas and structured layout.',
      icon: (
        <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
      color: 'bg-green-500/10 border-green-500/30 hover:border-green-500',
      disabled: false
    },
    {
      id: 'website_builder',
      title: 'Website Builder',
      description: 'Generate landing page layouts, code, and copy based on content.',
      icon: (
        <svg className="w-8 h-8 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      ),
      color: 'bg-sky-500/10 border-sky-500/30 hover:border-sky-500',
      disabled: !hasActiveSession
    },
    {
      id: 'product_research_tool',
      title: 'Product Research Tool',
      description: 'Discover profitable digital product niches before competitors with trend analysis and demand scoring.',
      icon: (
        <svg className="w-8 h-8 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
      color: 'bg-cyan-500/10 border-cyan-500/30 hover:border-cyan-500',
      disabled: false
    },
    {
      id: 'repo_merger',
      title: 'Repo Merger',
      description: 'Combine features and files from two GitHub repositories into a single new named repository — one commit, straight from the browser.',
      icon: (
        <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m16 3 4 4-4 4" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7H4" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m8 21-4-4 4-4" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 17h16" />
        </svg>
      ),
      color: 'bg-slate-500/10 border-slate-500/30 hover:border-slate-400',
      disabled: false
    }
  ];

  const defaultOrder = tools.map(t => t.id);
  const [toolOrder, setToolOrder] = React.useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('toolOrder_OfficeTools');
      if (saved) {
         const parsed = JSON.parse(saved);
         if (parsed.length === defaultOrder.length) return parsed;
      }
    } catch {}
    return defaultOrder;
  });

  const [isToolSettingsOpen, setIsToolSettingsOpen] = React.useState(false);

  const orderedTools = [...tools].sort((a, b) => {
    let indexA = toolOrder.indexOf(a.id);
    let indexB = toolOrder.indexOf(b.id);
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;
    return indexA - indexB;
  });

  const handleSaveOrder = (newOrder: string[]) => {
    setToolOrder(newOrder);
    localStorage.setItem('toolOrder_OfficeTools', JSON.stringify(newOrder));
  };

  

  return (
    <div className={`flex flex-col h-full w-full overflow-y-auto animate-fade-in p-6 md:p-10 transition-colors duration-300 ${st.bg} ${st.text}`}>
      {/* Header */}
      <div className="max-w-7xl w-full mx-auto mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-blue-600 mb-2">
            Office Tools
          </h1>
          <p className={`${st.textDim} text-sm`}>
            Advanced tools for general productivity and workspace management.
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          {/* View Toggles */}
          <div className={`flex items-center gap-1 p-1 border rounded-lg ${st.cardBg} ${st.border}`}>
            <button
              onClick={() => setViewMode(prev => prev === 'grid' ? 'list' : 'grid')}
              className={`p-1.5 rounded-md transition-colors ${(st as any).innerBg ? (st as any).innerBg : 'bg-transparent'} ${st.text} shadow-sm`}
              title="Toggle View Mode"
            >
              {viewMode === 'list' ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>

          {activeTool !== 'datasheet' && (
            <button
              onClick={() => setActiveTool('datasheet')}
              className="px-4 py-2 bg-gradient-to-r from-teal-500/10 to-sky-500/10 hover:from-teal-500/20 hover:to-sky-500/20 border border-teal-500/20 hover:border-teal-500/40 rounded-lg text-teal-400 text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-teal-500/5"
              title="Open Office Tools Datasheet"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Info</span>
            </button>
          )}

          
          

          
          <button
             onClick={() => setIsToolSettingsOpen(true)}
             className={`w-10 h-10 rounded-full border-2 transition-all duration-300 flex items-center justify-center hover:scale-110 active:scale-95 cursor-pointer ${st.btnInactive}`}
             title="Tool Settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Theme cycle button */}
          <button
            onClick={() => {
              const themes = Object.keys(themeStyles) as Array<keyof typeof themeStyles>;
              const nextIndex = (themes.indexOf(localTheme) + 1) % themes.length;
              const nextTheme = themes[nextIndex];
              setLocalTheme(nextTheme as any);
              localStorage.setItem('creative_studio_theme', nextTheme);
              window.dispatchEvent(new Event('creative_studio_theme_change'));
            }}
            className={`w-7 h-7 rounded-full border-2 transition-all duration-300 flex items-center justify-center hover:scale-110 active:scale-95 cursor-pointer ${
              localTheme === 'charcoal' 
                ? 'bg-zinc-900 border-zinc-600 shadow-md shadow-black/40' 
                : localTheme === 'silver' 
                ? 'bg-zinc-300 border-zinc-400 shadow-md shadow-zinc-500/20' 
                : localTheme === 'white' 
                ? 'bg-white border-zinc-300 shadow-md'
                : localTheme === 'cosmic' 
                ? 'bg-indigo-900 border-indigo-500 shadow-md shadow-indigo-950/50' 
                : localTheme === 'emerald' 
                ? 'bg-emerald-900 border-emerald-500 shadow-md shadow-emerald-950/50' 
                : localTheme === 'amber' 
                ? 'bg-amber-600 border-amber-500 shadow-md shadow-amber-950/50' 
                : localTheme === 'cyberpunk' 
                ? 'bg-fuchsia-900 border-cyan-400 shadow-md' 
                : localTheme === 'slate' 
                ? 'bg-slate-800 border-slate-500 shadow-md' 
                : localTheme === 'crimson'
                ? 'bg-rose-900 border-rose-500 shadow-md shadow-rose-950/50'
                : localTheme === 'orchid'
                ? 'bg-fuchsia-700 border-fuchsia-500 shadow-md shadow-fuchsia-950/50'
                : 'bg-stone-700 border-stone-500 shadow-md shadow-stone-950/50'
            }`}
            title={`Cycle theme (current: ${localTheme})`}
          />

          <button 
            onClick={onBack}
            className={`px-4 py-2 border rounded-lg text-sm font-bold transition-all flex items-center gap-1 ${st.btnInactive}`}
            title="Back to Library"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl w-full mx-auto relative">
        
        {/* Global Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-app-bg/80 backdrop-blur-sm rounded-2xl">
            <div className="flex flex-col items-center bg-app-panel p-8 rounded-2xl border border-app-border shadow-2xl">
              <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4"></div>
              <h3 className="text-xl font-bold text-app-text mb-2">Generating Content...</h3>
              <p className="text-app-dim text-sm text-center max-w-xs">
                Please wait while the AI analyzes your sources and creates the requested artifact. This may take a minute for audio.
              </p>
            </div>
          </div>
        )}

        {!activeTool ? (
          /* Tools Grid/List */
          <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" : "flex flex-col gap-4"}>
            {orderedTools.map((tool, index) => (
              <button
                key={tool.id}
                onClick={() => {
                  if (tool.disabled) return;
                  if (['travel_intell', 'bring_to_life', 'youtube_transcript', 'text_summarizer', 'podcast_creator', 'prompt_builder', 'content_builder', 'crypto_trading_assistant', 'stock_trading_assistant', 'currency_trading_assistant', 'spreadsheet_creator', 'datasheet', 'product_research_tool', 'social_generator', 'quiz_creator', 'exec_briefing', 'brainstormer', 'email_drafter', 'marketing_copy', 'swot_analysis', 'code_explainer', 'ebook_generator', 'website_builder', 'image_carver', 'repo_merger'].includes(tool.id)) {
                    setActiveTool(tool.id);
                  } else {
                    onRunTool(tool.id);
                    onBack();
                  }
                }}
                disabled={tool.disabled}
                className={`flex ${viewMode === 'grid' ? 'flex-col items-start p-6' : 'flex-row items-center p-4 gap-6'} rounded-2xl border transition-all text-left group ${tool.color} ${tool.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-lg hover:scale-[1.02] cursor-pointer'}`}
              >
                <div className={`${viewMode === 'grid' ? 'mb-4' : 'mb-0'} p-3 rounded-xl bg-app-bg border border-app-border group-hover:scale-110 transition-transform`}>
                  {tool.icon}
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-app-text mb-2">{index + 1}. {tool.title}</h3>
                  <p className="text-app-dim text-sm">{tool.description}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          /* Active Tool View */
          <div className={`border rounded-2xl p-6 md:p-8 animate-fade-in transition-colors duration-300 ${st.cardBg} ${st.border}`}>
            <button 
              onClick={() => setActiveTool(null)}
              className="mb-6 text-xs font-bold text-app-dim hover:text-app-text flex items-center gap-1 uppercase tracking-wider"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Tools
            </button>
            
            {activeTool === 'travel_intell' && (
              <div className="max-w-7xl mx-auto animate-fade-in">
                <TravelIntell session={session} onSaveArtifact={onSaveArtifact} st={st} />
              </div>
            )}

            {activeTool === 'bring_to_life' && (
              <div className="flex flex-col min-h-[60vh] relative">
                <div className={`flex flex-col items-center justify-center flex-1 transition-all duration-700 ${isCreationFocused ? 'opacity-0 scale-95 blur-sm pointer-events-none absolute inset-0' : 'opacity-100 scale-100 blur-0'}`}>
                   <div className="w-full mb-12">
                      <Hero />
                   </div>
                   <div className="w-full flex justify-center mb-12">
                      <InputArea onGenerate={handleGenerateCreation} isGenerating={isGeneratingCreation} disabled={isCreationFocused} />
                   </div>
                   <div className="w-full">
                      <CreationHistory 
                        history={bringToLifeHistory} 
                        onSelect={handleSelectCreation} 
                        onDelete={handleDeleteCreation}
                        onEdit={handleEditCreation}
                      />
                   </div>
                </div>

                <LivePreview
                  creation={activeCreation}
                  isLoading={isGeneratingCreation}
                  isFocused={isCreationFocused}
                  onReset={handleResetCreation}
                />

                {/* Import Button */}
                {!isCreationFocused && (
                  <div className="flex justify-end mt-8">
                    <button 
                        onClick={handleImportClick}
                        className="flex items-center gap-2 p-2 text-zinc-500 hover:text-zinc-300 transition-colors opacity-60 hover:opacity-100"
                        title="Import Artifact"
                    >
                        <span className="text-xs font-medium uppercase tracking-wider">Upload previous artifact (.json)</span>
                        <Upload className="w-4 h-4" />
                    </button>
                    <input 
                        type="file" 
                        ref={importInputRef} 
                        onChange={handleImportFile} 
                        accept=".json" 
                        className="hidden" 
                    />
                  </div>
                )}
              </div>
            )}

            {activeTool === 'youtube_transcript' && (
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <h2 className="text-2xl font-bold text-app-text flex items-center gap-3">
                      <span className="p-2 rounded-lg bg-red-500/20 text-red-400">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </span>
                      YouTube Transcript Generator
                    </h2>
                </div>
                
                <div className="space-y-6 bg-app-card border border-app-border rounded-xl p-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-app-dim uppercase mb-2">YouTube Link</label>
                            <input 
                                type="text" 
                                value={ytLink}
                                onChange={(e) => { setYtLink(e.target.value); setYtFile(null); }}
                                placeholder="https://www.youtube.com/watch?v=..."
                                className="w-full bg-app-bg border border-app-border rounded-lg p-3 text-app-text focus:border-red-500 focus:outline-none transition-colors"
                            />
                        </div>
                        
                        <div className="flex items-center gap-4">
                            <div className="h-px flex-1 bg-app-border"></div>
                            <span className="text-xs font-bold text-app-dim uppercase">OR</span>
                            <div className="h-px flex-1 bg-app-border"></div>
                        </div>
                        
                        <div>
                            <label className="block text-xs font-bold text-app-dim uppercase mb-2">Upload Video or Audio File</label>
                            <div className="relative">
                                <input 
                                    type="file" 
                                    accept="video/*,audio/*"
                                    onChange={(e) => {
                                        if (e.target.files?.[0]) {
                                            setYtFile(e.target.files[0]);
                                            setYtLink('');
                                        }
                                    }}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                />
                                <div className={`w-full border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors ${ytFile ? 'border-red-500 bg-red-500/5' : 'border-app-border bg-app-bg hover:border-red-500/50 hover:bg-red-500/5'}`}>
                                    <svg className={`w-8 h-8 mb-2 ${ytFile ? 'text-red-400' : 'text-app-dim'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                    </svg>
                                    <span className={`text-sm font-bold ${ytFile ? 'text-red-400' : 'text-app-text'}`}>
                                        {ytFile ? ytFile.name : 'Click or drag media file here'}
                                    </span>
                                    {!ytFile && <span className="text-xs text-app-dim mt-1">MP4, MP3, WAV, etc.</span>}
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="pt-6 border-t border-app-border">
                        <label className="block text-xs font-bold text-app-dim uppercase mb-3">Transcription Duration</label>
                        <div className="grid grid-cols-4 gap-3">
                            {['1', '3', '5', 'All'].map((dur) => (
                                <button
                                    key={dur}
                                    onClick={() => setYtDuration(dur)}
                                    className={`py-2 rounded-lg border text-sm font-bold transition-all ${ytDuration === dur ? 'bg-red-500 text-white border-red-500 shadow-lg shadow-red-500/20' : 'bg-app-bg border-app-border text-app-dim hover:text-app-text hover:border-red-500/50'}`}
                                >
                                    {dur === 'All' ? 'Full Video' : `${dur} Min`}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    <div className="pt-6">
                        <button 
                            onClick={handleGenerateTranscript}
                            disabled={isLoading || (!ytLink && !ytFile)}
                            className="w-full py-4 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white font-bold rounded-xl shadow-lg shadow-red-500/20 transition-all transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    <span>Generating Transcript...</span>
                                </>
                            ) : (
                                <>
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                    </svg>
                                    <span>Generate Transcript</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
              </div>
            )}

            {activeTool === 'text_summarizer' && (
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <h2 className="text-2xl font-bold text-app-text flex items-center gap-3">
                      <span className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </span>
                      Text Summarizer & Translator
                    </h2>
                    {onOpenMIPrOMPT && (
                        <button 
                            onClick={onOpenMIPrOMPT}
                            className="p-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-lg transition-all shadow-lg flex items-center justify-center"
                            title="mIPrOMPT Library"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                            </svg>
                        </button>
                    )}
                </div>
                
                <div className="space-y-6 bg-app-card border border-app-border rounded-xl p-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-app-dim uppercase mb-2">Paste Text</label>
                            <textarea 
                                value={summaryText}
                                onChange={(e) => { setSummaryText(e.target.value); setSummaryFile(null); }}
                                placeholder="Paste your text here..."
                                className="w-full h-32 bg-app-bg border border-app-border rounded-lg p-3 text-app-text focus:border-emerald-500 focus:outline-none transition-colors resize-none"
                            />
                        </div>
                        
                        <div className="flex items-center gap-4">
                            <div className="h-px flex-1 bg-app-border"></div>
                            <span className="text-xs font-bold text-app-dim uppercase">OR</span>
                            <div className="h-px flex-1 bg-app-border"></div>
                        </div>
                        
                        <div>
                            <label className="block text-xs font-bold text-app-dim uppercase mb-2">Upload File</label>
                            <div className="relative">
                                <input 
                                    type="file" 
                                    accept=".txt,.md,.csv,.json,.doc,.docx,.pdf"
                                    onChange={(e) => {
                                        if (e.target.files?.[0]) {
                                            setSummaryFile(e.target.files[0]);
                                            setSummaryText('');
                                        }
                                    }}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                />
                                <div className={`w-full border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors ${summaryFile ? 'border-emerald-500 bg-emerald-500/5' : 'border-app-border bg-app-bg hover:border-emerald-500/50 hover:bg-emerald-500/5'}`}>
                                    <svg className={`w-8 h-8 mb-2 ${summaryFile ? 'text-emerald-400' : 'text-app-dim'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <span className={`text-sm font-medium ${summaryFile ? 'text-emerald-400' : 'text-app-dim'}`}>
                                        {summaryFile ? summaryFile.name : 'Click or drag file to upload'}
                                    </span>
                                    <span className="text-xs text-app-dim mt-1">Supports TXT, MD, CSV, JSON, DOC, DOCX, PDF</span>
                                </div>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-app-dim uppercase mb-2">Action</label>
                                <select 
                                    value={summaryAction}
                                    onChange={(e) => setSummaryAction(e.target.value)}
                                    className="w-full bg-app-bg border border-app-border rounded-lg p-3 text-app-text focus:border-emerald-500 focus:outline-none transition-colors appearance-none"
                                >
                                    <option value="summarize">Summarize</option>
                                    <option value="translate">Translate</option>
                                    <option value="summarize_translate">Summarize & Translate</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-app-dim uppercase mb-2">Target Language</label>
                                <select 
                                    value={summaryLang}
                                    onChange={(e) => setSummaryLang(e.target.value)}
                                    className="w-full bg-app-bg border border-app-border rounded-lg p-3 text-app-text focus:border-emerald-500 focus:outline-none transition-colors appearance-none"
                                >
                                    <option value="swedish">Swedish</option>
                                    <option value="english">English</option>
                                </select>
                            </div>
                        </div>
                        
                        <button 
                            onClick={handleGenerateSummary}
                            disabled={isLoading || (!summaryText && !summaryFile)}
                            className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${isLoading || (!summaryText && !summaryFile) ? 'bg-app-bg text-app-dim cursor-not-allowed border border-app-border' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'}`}
                        >
                            {isLoading ? (
                                <>
                                    <svg className="animate-spin h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    Generate
                                </>
                            )}
                        </button>
                    </div>
                </div>
              </div>
            )}

            {activeTool === 'podcast_creator' && (
              <PodcastCreator
                  voiceSettings={voiceSettings}
                  onUpdateVoiceSettings={onUpdateVoiceSettings}
                  onRunTool={onRunTool}
                  isLoading={isLoading}
                  hasActiveSession={hasActiveSession}
                  session={session}
                  castLibrary={castLibrary}
                  setIsCastLibraryOpen={setIsCastLibraryOpen}
                  activeFormat={activeFormat}
                  onSelectFormat={setActiveFormat}
                  onOpenHistory={() => setShowHistory(true)}
                  onOpenPrompts={() => setShowPrompts(true)}
                  touchedRoles={touchedRoles}
                  setTouchedRoles={setTouchedRoles}
                  customInput={podcastCustomInput}
                  onChangeCustomInput={setPodcastCustomInput}
                  includeSessionData={podcastIncludeSessionData}
                  onChangeIncludeSessionData={setPodcastIncludeSessionData}
              />
            )}

            {activeTool === 'crypto_trading_assistant' && (
              <div className="animate-fade-in -m-6 md:-m-8">
                <CryptoTradingAssistant />
              </div>
            )}

            {activeTool === 'stock_trading_assistant' && (
              <div className="animate-fade-in -m-6 md:-m-8">
                <StockTradingAssistant />
              </div>
            )}

            {activeTool === 'currency_trading_assistant' && (
              <div className="animate-fade-in -m-6 md:-m-8">
                <CurrencyTradingAssistant />
              </div>
            )}

            {activeTool === 'spreadsheet_creator' && (
              <div className="animate-fade-in max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-bold text-app-text flex items-center gap-3">
                    <span className="p-2 rounded-lg bg-green-500/20 text-green-400">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </span>
                    Smart Spreadsheet Model Creator
                  </h2>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left Column Controls */}
                  <div className="lg:col-span-5 space-y-6 bg-app-card border border-app-border rounded-2xl p-6">
                    <div>
                      <label className="block text-xs font-bold text-app-dim uppercase mb-2">Spreadsheet Title</label>
                      <input 
                        type="text" 
                        value={sheetName} 
                        onChange={(e) => setSheetName(e.target.value)}
                        placeholder="e.g. Q3 Financial Plan"
                        className="w-full bg-app-bg border border-app-border rounded-xl px-4 py-3 text-app-text focus:outline-none focus:border-green-500 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-app-dim uppercase mb-2">Rows Count ({sheetRows} Rows)</label>
                      <div className="flex items-center gap-4">
                        <input 
                          type="range" 
                          min="5" 
                          max="40" 
                          value={sheetRows} 
                          onChange={(e) => setSheetRows(parseInt(e.target.value))}
                          className="flex-1 accent-green-500 bg-app-bg"
                        />
                        <span className="text-xs font-bold bg-green-500/10 text-green-400 px-2.5 py-1 rounded-lg">{sheetRows} rows</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-app-dim uppercase mb-2">Select Template Preset</label>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(SHEET_TEMPLATES).map(([key, value]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              setSheetTemplate(key);
                              setSheetName(value.name);
                            }}
                            className={`p-3 text-left rounded-xl border text-xs font-medium transition-all ${sheetTemplate === key ? 'bg-green-500/10 border-green-500 text-green-400' : 'bg-app-bg border-app-border text-app-dim hover:text-app-text hover:border-zinc-700'}`}
                          >
                            {value.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {hasActiveSession && (
                      <div>
                        <label className="flex items-center gap-3 cursor-pointer p-4 bg-app-bg border border-app-border rounded-xl hover:border-green-500/50 transition-all select-none">
                          <input 
                            type="checkbox" 
                            checked={useSessionData} 
                            onChange={(e) => setUseSessionData(e.target.checked)} 
                            className="w-4 h-4 rounded bg-app-panel border-app-border text-green-500 focus:ring-green-500/30 accent-green-500"
                          />
                          <div>
                            <span className="text-xs font-bold text-app-text block">Use Workspace Session Context</span>
                            <span className="text-[10px] text-app-dim block mt-0.5">Use active transcripts and files to fill custom rows.</span>
                          </div>
                        </label>
                      </div>
                    )}

                    <div className="border-t border-app-border pt-6">
                      <label className="block text-xs font-bold text-app-dim uppercase mb-2">AI Custom Dictation / Prompt</label>
                      <div className="space-y-4">
                        <textarea
                          rows={4}
                          value={sheetCustomPrompt}
                          onChange={(e) => setSheetCustomPrompt(e.target.value)}
                          placeholder="Dictate template requirements, custom spreadsheet headers, calculation instructions..."
                          className="w-full bg-app-bg border border-app-border rounded-xl px-4 py-3 text-app-text placeholder-zinc-600 focus:outline-none focus:border-green-500 transition-colors text-xs resize-none"
                        />
                        <div className="flex justify-end">
                          <AudioInput 
                            onTranscript={(text) => {
                              setSheetCustomPrompt(prev => prev ? `${prev} ${text}` : text);
                            }}
                            placeholder="Speak template custom directives..."
                            className="scale-90"
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleGenerateSpreadsheet}
                      disabled={isGeneratingSheet}
                      className="w-full py-3.5 bg-green-500 hover:bg-green-600 disabled:opacity-40 text-black font-bold text-sm tracking-wide rounded-xl shadow-lg transition-transform hover:scale-[1.01] flex items-center justify-center gap-2"
                    >
                      {isGeneratingSheet ? (
                        <>
                          <svg className="animate-spin h-5 w-5 text-black" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Generating Spreadsheet Model...
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                          </svg>
                          Compile & Build Spreadsheet
                        </>
                      )}
                    </button>
                  </div>

                  {/* Right Column Preview Table */}
                  <div className="lg:col-span-7 flex flex-col justify-between">
                    {spreadsheetResult ? (
                      <div className="bg-app-card border border-app-border rounded-2xl p-6 flex-1 flex flex-col min-h-[400px]">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-app-border pb-4 mb-4">
                          <div>
                            <h3 className="text-base font-bold text-app-text">{spreadsheetResult.sheetName}</h3>
                            <p className="text-[11px] text-app-dim mt-0.5">Showing compiled preview model with {spreadsheetResult.rows.length} records</p>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={downloadCSV}
                              className="px-3.5 py-2 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 text-xs font-bold flex items-center gap-1.5 transition-all"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Export CSV
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => {
                                setSpreadsheetResult(null);
                                setSheetSearch('');
                              }}
                              className="p-2 rounded-xl bg-app-bg text-app-dim hover:text-white border border-app-border transition-colors text-xs"
                              title="Clear Results"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Search Filter bar */}
                        <div className="mb-4">
                          <div className="relative">
                            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-app-dim">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                            </span>
                            <input
                              type="text"
                              value={sheetSearch}
                              onChange={(e) => setSheetSearch(e.target.value)}
                              placeholder="Search rows..."
                              className="w-full bg-app-bg border border-app-border rounded-xl pl-9 pr-4 py-2 text-xs text-app-text focus:outline-none focus:border-green-500 transition-colors"
                            />
                          </div>
                        </div>

                        {/* Table Display */}
                        <div className="flex-1 overflow-x-auto border border-app-border rounded-xl bg-app-bg max-h-[360px]">
                          <table className="w-full border-collapse text-left text-xs text-app-text">
                            <thead>
                              <tr className="bg-app-card border-b border-app-border sticky top-0 z-10">
                                {spreadsheetResult.columns.map((col, idx) => (
                                  <th key={idx} className="p-3 font-bold text-app-dim bg-app-card uppercase tracking-wider text-[10px] whitespace-nowrap">{col}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-app-border">
                              {spreadsheetResult.rows
                                .filter(row => row.some(cell => String(cell).toLowerCase().includes(sheetSearch.toLowerCase())))
                                .map((row, rowIdx) => (
                                  <tr key={rowIdx} className="hover:bg-green-500/[0.02] transition-colors">
                                    {row.map((cell, cellIdx) => (
                                      <td key={cellIdx} className="p-3 text-app-text whitespace-nowrap">{String(cell)}</td>
                                    ))}
                                  </tr>
                                ))
                              }
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-app-card border border-app-border rounded-2xl p-6 flex-1 flex flex-col items-center justify-center text-center py-16">
                        <span className="p-4 rounded-full bg-green-500/5 text-green-500 border border-green-500/10 mb-4">
                          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </span>
                        <h3 className="text-base font-bold text-app-text mb-2">No Spreadsheet Generated Yet</h3>
                        <p className="text-xs text-app-dim max-w-sm mb-6 leading-relaxed">Customize your name and parameters, dictate prompts or use session context sources, then build and compile to analyze your data.</p>
                        
                        <div className="flex flex-wrap justify-center gap-2 max-w-md">
                          <span className="text-[10px] px-2.5 py-1 rounded bg-app-bg border border-app-border text-app-dim font-mono">100% Client-Side Ready</span>
                          <span className="text-[10px] px-2.5 py-1 rounded bg-app-bg border border-app-border text-app-dim font-mono">Export to CSV File</span>
                          <span className="text-[10px] px-2.5 py-1 rounded bg-app-bg border border-app-border text-app-dim font-mono">AI Custom Columns</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            

            

            

            {activeTool === 'product_research_tool' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <ProductResearchTool 
                  session={session} 
                  onSaveArtifact={onSaveArtifact}
                />
              </div>
            )}

            {activeTool === 'image_carver' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <ImageCarverTool />
              </div>
            )}

            {activeTool === 'repo_merger' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <RepoMergerView embedded />
              </div>
            )}
            
            
            {activeTool === 'social_generator' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <SocialMediaSuite 
                  session={session} 
                  onSaveArtifact={onSaveArtifact}
                />
              </div>
            )}

            {activeTool === 'quiz_creator' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <QuizAssessmentCreator 
                  session={session} 
                  onSaveArtifact={onSaveArtifact}
                />
              </div>
            )}

            {activeTool === 'exec_briefing' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <ExecutiveBriefing 
                  session={session} 
                  onSaveArtifact={onSaveArtifact}
                />
              </div>
            )}

            {activeTool === 'brainstormer' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <Brainstormer 
                  session={session} 
                  onSaveArtifact={onSaveArtifact}
                />
              </div>
            )}

            {activeTool === 'email_drafter' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <EmailDrafter 
                  session={session} 
                  onSaveArtifact={onSaveArtifact}
                />
              </div>
            )}

            {activeTool === 'marketing_copy' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <MarketingCopywriter 
                  session={session} 
                  onSaveArtifact={onSaveArtifact}
                />
              </div>
            )}

            {activeTool === 'swot_analysis' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <SwotAnalysis 
                  session={session} 
                  onSaveArtifact={onSaveArtifact}
                />
              </div>
            )}

            {activeTool === 'code_explainer' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <CodeExplainer 
                  session={session} 
                  onSaveArtifact={onSaveArtifact}
                />
              </div>
            )}

            {activeTool === 'ebook_generator' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <EbookGenerator 
                  session={session} 
                  onSaveArtifact={onSaveArtifact}
                />
              </div>
            )}

            {activeTool === 'website_builder' && (
              <div className="max-w-6xl mx-auto animate-fade-in">
                <WebsiteBuilder 
                  session={session} 
                  onSaveArtifact={onSaveArtifact}
                />
              </div>
            )}

            {activeTool === 'datasheet' && (
              <div className="max-w-7xl mx-auto animate-fade-in">
                <OfficeDatasheet 
                  onRunTool={(toolId) => {
                    // Map local app IDs to internal runtime tool IDs
                    const DATASHEET_ID_MAP: Record<string, string> = {
                      app1: 'bring_to_life',
                      app2: 'podcast_creator',
                      app3: 'prompt_builder',
                      app4: 'content_builder',
                      app5: 'youtube_transcript',
                      app6: 'text_summarizer',
                      app7: 'social_generator',
                      app8: 'quiz_creator',
                      app9: 'exec_briefing',
                      app10: 'brainstormer',
                      app11: 'email_drafter',
                      app12: 'marketing_copy',
                      app13: 'swot_analysis',
                      app14: 'code_explainer',
                      app15: 'ebook_generator',
                      app16: 'image_generator',
                      app17: 'spreadsheet_creator',
                      app19: 'website_builder',
                      app22: 'product_research_tool',
                      app23: 'travel_intell'
                    };
                    const mappedId = DATASHEET_ID_MAP[toolId] || toolId;
                    
                    // Let the user switch tools directly from the datasheet!
                    if (['travel_intell', 'bring_to_life', 'youtube_transcript', 'text_summarizer', 'podcast_creator', 'prompt_builder', 'content_builder', 'crypto_trading_assistant', 'stock_trading_assistant', 'currency_trading_assistant', 'spreadsheet_creator', 'product_research_tool', 'social_generator', 'quiz_creator', 'exec_briefing', 'brainstormer', 'email_drafter', 'marketing_copy', 'swot_analysis', 'code_explainer', 'ebook_generator', 'website_builder'].includes(mappedId)) {
                      setActiveTool(mappedId);
                    } else {
                      onRunTool(mappedId);
                      onBack();
                    }
                  }}
                  onClose={() => setActiveTool(null)}
                />
              </div>
            )}

            {(activeTool === 'prompt_builder' || activeTool === 'content_builder') && (
                <div className="max-w-6xl mx-auto animate-fade-in">
                    <div className="flex items-center justify-between mb-8">
                        <h2 className="text-2xl font-bold text-app-text flex items-center gap-3">
                            <span className={`p-2 rounded-lg ${activeTool === 'prompt_builder' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-orange-500/20 text-orange-400'}`}>
                                {activeTool === 'prompt_builder' ? (
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                ) : (
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9.5a2.5 2.5 0 00-2.5-2.5H15M9 11l3 3L22 4" />
                                    </svg>
                                )}
                            </span>
                            {activeTool === 'prompt_builder' ? 'Prompt Builder' : 'Content Builder'}
                        </h2>
                        {onOpenMIPrOMPT && (
                            <button 
                                onClick={onOpenMIPrOMPT}
                                className="p-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-lg transition-all shadow-lg flex items-center justify-center"
                                title="mIPrOMPT Library"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                </svg>
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                        {/* Main Builder Form */}
                        <div className="lg:col-span-7 bg-app-card border border-app-border rounded-xl p-6 space-y-6 overflow-hidden relative h-fit">
                        <div className={`transition-transform duration-300 ${builderStep === 1 ? 'translate-x-0' : '-translate-x-full absolute opacity-0 pointer-events-none'}`}>
                            <div className="space-y-6">
                                <div className="mb-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                            <label className="block text-xs font-bold text-app-dim uppercase">Quick Templates</label>
                                            <label className="flex items-center gap-1 cursor-pointer group">
                                                <input 
                                                    type="checkbox" 
                                                    checked={showAdvancedTemplates}
                                                    onChange={(e) => setShowAdvancedTemplates(e.target.checked)}
                                                    className="w-3 h-3 rounded bg-app-bg border border-app-border accent-emerald-500 cursor-pointer"
                                                />
                                                <span className="text-[10px] text-app-dim group-hover:text-app-text transition-colors">Show Advanced</span>
                                            </label>
                                        </div>
                                        <button 
                                            onClick={() => {
                                                const templates = activeTool === 'prompt_builder' ? promptTemplates : contentTemplates;
                                                const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
                                                setBuilderInput(randomTemplate.prompt);
                                                setSelectedTemplate(randomTemplate.id);
                                            }}
                                            className="px-2 py-1 bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-purple-400 hover:text-purple-300 text-[10px] font-bold rounded border border-purple-500/30 transition-all flex items-center gap-1"
                                        >
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                            </svg>
                                            Quick Suggestion
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {(activeTool === 'prompt_builder' ? promptTemplates : contentTemplates).map(t => (
                                            <button 
                                                key={t.id}
                                                onClick={() => {
                                                    setBuilderInput(t.prompt);
                                                    setSelectedTemplate(t.id);
                                                }}
                                                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${selectedTemplate === t.id ? 'bg-app-text text-app-bg border-app-text' : 'bg-app-bg text-app-dim border-app-border hover:border-app-text hover:text-app-text'}`}
                                            >
                                                {t.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <label className="block text-xs font-bold text-app-dim uppercase">Instructions / Topic</label>
                                            <AudioInput 
                                                onTranscript={(text) => {
                                                    setBuilderInput(prev => prev ? `${prev} ${text}` : text);
                                                    setSelectedTemplate(null);
                                                }}
                                                placeholder="Speak instructions..."
                                                className="scale-90"
                                            />
                                        </div>
                                        {builderInput.trim() && onAddMIPrOMPT && (
                                            <button 
                                                onClick={() => {
                                                    const timestamp = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                                                    const autoTitle = activeTool === 'prompt_builder' ? `Custom Prompt (${timestamp})` : `Custom Builder (${timestamp})`;
                                                    onAddMIPrOMPT(activeTool === 'prompt_builder' ? 'prB' : 'ctB', builderInput, autoTitle);
                                                }}
                                                className="px-2 py-1 text-[10px] font-bold rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors border border-blue-500/30"
                                            >
                                                + Save to mIPrOMPT Library
                                            </button>
                                        )}
                                    </div>
                                    <textarea 
                                        value={builderInput}
                                        onChange={(e) => {
                                            setBuilderInput(e.target.value);
                                            setSelectedTemplate(null);
                                        }}
                                        placeholder={`Describe what you want to ${activeTool === 'prompt_builder' ? 'generate a prompt for' : 'build exactly'}, or leave empty if your selected session contains all required instructions.`}
                                        className="w-full h-32 bg-app-bg border border-app-border rounded-lg p-3 text-app-text focus:border-app-text focus:outline-none transition-colors resize-none mb-1"
                                    />
                                    <div className="text-[10px] text-app-dim mt-2 flex flex-wrap gap-2 items-center">
                                        {[
                                            { id: 'product', val: builderProductType, set: setBuilderProductType },
                                            { id: 'niche', val: builderNiche, set: setBuilderNiche },
                                            { id: 'skill', val: builderSkillLevel, set: setBuilderSkillLevel },
                                            { id: 'goal', val: builderPrimaryGoal, set: setBuilderPrimaryGoal },
                                            { id: 'platform', val: builderSellingPlatform, set: setBuilderSellingPlatform },
                                            { id: 'color', val: builderColorScheme, set: setBuilderColorScheme },
                                            { id: 'promotion', val: builderPromotionStrategy, set: setBuilderPromotionStrategy },
                                        ].filter(c => c.val).map(config => {
                                            const isGrey = greyedConfigs.includes(config.id);
                                            return (
                                                <span 
                                                    key={config.id}
                                                    onClick={() => setGreyedConfigs(prev => prev.includes(config.id) ? prev.filter(id => id !== config.id) : [...prev, config.id])}
                                                    onDoubleClick={() => {
                                                        config.set('');
                                                        setGreyedConfigs(prev => prev.filter(id => id !== config.id));
                                                    }}
                                                    className={`cursor-pointer font-bold px-2 py-0.5 rounded border transition-colors select-none ${isGrey ? 'bg-app-bg text-app-dim border-app-border opacity-50 hover:opacity-100' : 'bg-app-text text-app-bg border-app-text hover:bg-app-text/80'}`}
                                                    title="Click to grey out, Double-click to remove completely"
                                                >
                                                    {config.val}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block text-xs font-bold text-app-dim uppercase mb-2">Include Session Data (Optional)</label>
                                    <select 
                                        value={builderSessionId}
                                        onChange={(e) => setBuilderSessionId(e.target.value)}
                                        className="w-full bg-app-bg border border-app-border text-sm text-app-text rounded-lg px-3 py-3 focus:outline-none focus:border-app-text transition-colors cursor-pointer"
                                    >
                                        <option value="none">-- Do Not Include Session Data --</option>
                                        {sessions.map(s => (
                                            <option key={s.id} value={s.id}>
                                                {s.name} ({s.mediaItems.length} items)
                                            </option>
                                        ))}
                                    </select>
                                    <div className="text-[10px] text-app-dim mt-2">
                                        Use selected sources from a specific session as background context for your generation.
                                    </div>
                                </div>

                                <div className="flex gap-4 mt-6">
                                    <button 
                                        onClick={() => handleIndependentBuilderGenerate(activeTool)}
                                        className="flex-1 py-4 bg-app-text text-app-bg font-bold rounded-xl shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                                        </svg>
                                        Quick Generate
                                    </button>
                                    <button 
                                        onClick={() => setBuilderStep(2)}
                                        className="flex-1 py-4 bg-app-panel text-app-text font-bold border border-app-border rounded-xl shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                                    >
                                        Options+
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        <div className={`transition-transform duration-300 ${builderStep === 2 ? 'translate-x-0' : 'translate-x-full absolute opacity-0 pointer-events-none top-6 left-6 right-6'}`}>
                            <div className="space-y-6">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => setBuilderStep(1)} className="text-sm font-bold text-app-dim hover:text-app-text flex items-center gap-1">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                                            </svg>
                                            Back
                                        </button>
                                        <h3 className="text-lg font-bold text-app-text ml-2">Advanced Configuration</h3>
                                    </div>
                                    <button 
                                        onClick={() => {
                                            setBuilderProductType(productTypePresets[Math.floor(Math.random() * productTypePresets.length)]);
                                            setBuilderNiche(nichePresets[Math.floor(Math.random() * nichePresets.length)]);
                                            setBuilderSkillLevel(skillLevelPresets[Math.floor(Math.random() * skillLevelPresets.length)]);
                                            setBuilderPrimaryGoal(primaryGoalPresets[Math.floor(Math.random() * primaryGoalPresets.length)]);
                                            setBuilderSellingPlatform(sellingPlatformPresets[Math.floor(Math.random() * sellingPlatformPresets.length)]);
                                            setBuilderColorScheme(colorSchemePresets[Math.floor(Math.random() * colorSchemePresets.length)]);
                                            setBuilderPromotionStrategy(promotionStrategyPresets[Math.floor(Math.random() * promotionStrategyPresets.length)]);
                                        }}
                                        className="px-3 py-1.5 bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-purple-400 hover:text-purple-300 text-xs font-bold rounded border border-purple-500/30 transition-all flex items-center gap-2"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                                        </svg>
                                        Quick Suggestion
                                    </button>
                                </div>
                                <div className="space-y-8">
                                    <div>
                                        <label className="block text-xs font-bold text-app-text uppercase mb-2">Product Type</label>
                                        <input type="text" value={builderProductType} onChange={e => setBuilderProductType(e.target.value)} placeholder="Type or select below..." className="w-full bg-app-bg border border-app-border text-sm text-app-text rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-app-text transition-colors"/>
                                        <div className="flex flex-wrap gap-2">
                                            {productTypePresets.map(preset => (
                                                <button key={preset} onClick={() => setBuilderProductType(preset)} className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${builderProductType === preset ? 'bg-app-text text-app-bg border-app-text font-bold' : 'bg-app-panel text-app-dim border-app-border hover:bg-app-bg hover:text-app-text'}`}>{preset}</button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-app-text uppercase mb-2">Niche / Topic</label>
                                        <input type="text" value={builderNiche} onChange={e => setBuilderNiche(e.target.value)} placeholder="Type or select below..." className="w-full bg-app-bg border border-app-border text-sm text-app-text rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-app-text transition-colors"/>
                                        <div className="flex flex-wrap gap-2">
                                            {nichePresets.map(preset => (
                                                <button key={preset} onClick={() => setBuilderNiche(preset)} className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${builderNiche === preset ? 'bg-app-text text-app-bg border-app-text font-bold' : 'bg-app-panel text-app-dim border-app-border hover:bg-app-bg hover:text-app-text'}`}>{preset}</button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-app-text uppercase mb-2">Skill Level</label>
                                        <input type="text" value={builderSkillLevel} onChange={e => setBuilderSkillLevel(e.target.value)} placeholder="Type or select below..." className="w-full bg-app-bg border border-app-border text-sm text-app-text rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-app-text transition-colors"/>
                                        <div className="flex flex-wrap gap-2">
                                            {skillLevelPresets.map(preset => (
                                                <button key={preset} onClick={() => setBuilderSkillLevel(preset)} className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${builderSkillLevel === preset ? 'bg-app-text text-app-bg border-app-text font-bold' : 'bg-app-panel text-app-dim border-app-border hover:bg-app-bg hover:text-app-text'}`}>{preset}</button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-app-text uppercase mb-2">Primary Goal</label>
                                        <input type="text" value={builderPrimaryGoal} onChange={e => setBuilderPrimaryGoal(e.target.value)} placeholder="Type or select below..." className="w-full bg-app-bg border border-app-border text-sm text-app-text rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-app-text transition-colors"/>
                                        <div className="flex flex-wrap gap-2">
                                            {primaryGoalPresets.map(preset => (
                                                <button key={preset} onClick={() => setBuilderPrimaryGoal(preset)} className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${builderPrimaryGoal === preset ? 'bg-app-text text-app-bg border-app-text font-bold' : 'bg-app-panel text-app-dim border-app-border hover:bg-app-bg hover:text-app-text'}`}>{preset}</button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-app-text uppercase mb-2">Selling Platform</label>
                                        <input type="text" value={builderSellingPlatform} onChange={e => setBuilderSellingPlatform(e.target.value)} placeholder="Type or select below..." className="w-full bg-app-bg border border-app-border text-sm text-app-text rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-app-text transition-colors"/>
                                        <div className="flex flex-wrap gap-2">
                                            {sellingPlatformPresets.map(preset => (
                                                <button key={preset} onClick={() => setBuilderSellingPlatform(preset)} className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${builderSellingPlatform === preset ? 'bg-app-text text-app-bg border-app-text font-bold' : 'bg-app-panel text-app-dim border-app-border hover:bg-app-bg hover:text-app-text'}`}>{preset}</button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-app-text uppercase mb-2">Color Scheme</label>
                                        <input type="text" value={builderColorScheme} onChange={e => setBuilderColorScheme(e.target.value)} placeholder="Type or select below..." className="w-full bg-app-bg border border-app-border text-sm text-app-text rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-app-text transition-colors"/>
                                        <div className="flex flex-wrap gap-2">
                                            {colorSchemePresets.map(preset => (
                                                <button key={preset} onClick={() => setBuilderColorScheme(preset)} className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${builderColorScheme === preset ? 'bg-app-text text-app-bg border-app-text font-bold' : 'bg-app-panel text-app-dim border-app-border hover:bg-app-bg hover:text-app-text'}`}>{preset}</button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-app-text uppercase mb-2">Promotion Strategy</label>
                                        <input type="text" value={builderPromotionStrategy} onChange={e => setBuilderPromotionStrategy(e.target.value)} placeholder="Type or select below..." className="w-full bg-app-bg border border-app-border text-sm text-app-text rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-app-text transition-colors"/>
                                        <div className="flex flex-wrap gap-2">
                                            {promotionStrategyPresets.map(preset => (
                                                <button key={preset} onClick={() => setBuilderPromotionStrategy(preset)} className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${builderPromotionStrategy === preset ? 'bg-app-text text-app-bg border-app-text font-bold' : 'bg-app-panel text-app-dim border-app-border hover:bg-app-bg hover:text-app-text'}`}>{preset}</button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <button 
                                    onClick={() => handleIndependentBuilderGenerate(activeTool)}
                                    className="w-full py-4 mt-8 bg-app-text text-app-bg font-bold rounded-xl shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                                    </svg>
                                    Generate Final
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* mIPrOMPT Library Explorer Panel */}
                    {(() => {
                        const filteredMIPrompts = (miprompts || []).filter(item => {
                            const matchesSearch = item.name.toLowerCase().includes(mipromptSearch.toLowerCase()) || 
                                                  item.content.toLowerCase().includes(mipromptSearch.toLowerCase());
                            const matchesFilter = mipromptFilter === 'all' || item.type === mipromptFilter;
                            return matchesSearch && matchesFilter;
                        }).sort((a, b) => b.createdAt - a.createdAt);

                        return (
                            <div className="lg:col-span-5 bg-app-card border border-app-border rounded-xl p-6 flex flex-col h-[740px] sticky top-6">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-base font-bold text-app-text flex items-center gap-1.5">
                                            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                            </svg>
                                            mIPrOMPT Quick Access
                                        </h3>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-app-panel border border-app-border text-app-dim font-mono font-bold">
                                            {filteredMIPrompts.length}
                                        </span>
                                    </div>
                                    
                                    {onOpenMIPrOMPT && (
                                        <button 
                                            onClick={onOpenMIPrOMPT}
                                            className="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-0.5"
                                            title="Open library with CSV import/export"
                                        >
                                            Manage Library ↗
                                        </button>
                                    )}
                                </div>
                                <p className="text-[11px] text-app-dim mb-4 leading-relaxed">
                                    Click a card to read its full text. Use the actions below each card to instantly load or append it into your active input text above.
                                </p>

                                {/* Search bar */}
                                <div className="relative mb-3">
                                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-app-dim">
                                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                        </svg>
                                    </div>
                                    <input 
                                        type="text" 
                                        placeholder="Search custom library..." 
                                        value={mipromptSearch} 
                                        onChange={e => setMipromptSearch(e.target.value)} 
                                        className="w-full bg-app-bg border border-app-border text-xs text-app-text focus:outline-none focus:border-app-text rounded-lg pl-8 pr-6 py-2 transition-colors" 
                                    />
                                    {mipromptSearch && (
                                        <button 
                                            onClick={() => setMipromptSearch('')}
                                            className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-app-dim hover:text-app-text"
                                        >
                                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    )}
                                </div>

                                {/* Filter Tabs */}
                                <div className="flex bg-app-bg rounded-lg p-0.5 border border-app-border mb-4 overflow-x-auto whitespace-nowrap">
                                    {[
                                        { id: 'all', label: 'All' },
                                        { id: 'prB', label: 'Prompts' },
                                        { id: 'ctB', label: 'Content' },
                                        { id: 'txS', label: 'Summary' }
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setMipromptFilter(tab.id as any)}
                                            className={`flex-1 text-[10px] px-2 py-1 font-bold rounded transition-colors ${mipromptFilter === tab.id ? 'bg-app-text text-app-bg font-extrabold' : 'text-app-dim hover:text-app-text'}`}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Custom Prompt List */}
                                <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                                    {filteredMIPrompts.length === 0 ? (
                                        <div className="text-center py-12 border border-dashed border-app-border rounded-xl text-app-dim space-y-2">
                                            <svg className="w-8 h-8 text-app-dim mx-auto opacity-45" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            <p className="text-xs">No matching prompts found.</p>
                                            {miprompts.length === 0 && (
                                                <p className="text-[10px] text-app-dim/60 p-2">Your custom library is currently empty. Dictate or write some builder instructions on the left to save them!</p>
                                            )}
                                        </div>
                                    ) : (
                                        filteredMIPrompts.map(item => {
                                            const typeColor = item.type === 'prB' ? 'border-yellow-500/30 text-yellow-500 bg-yellow-500/10' :
                                                              item.type === 'ctB' ? 'border-orange-500/30 text-orange-500 bg-orange-500/10' :
                                                              'border-emerald-500/30 text-emerald-500 bg-emerald-500/10';
                                            const typeLabel = item.type === 'prB' ? 'Prompt' :
                                                              item.type === 'ctB' ? 'Content' :
                                                              'Summary';
                                            
                                            // Clean name
                                            const displayName = item.name.split('-').pop()?.replace(/_/g, ' ') || item.name;

                                            return (
                                                <div 
                                                    key={item.id}
                                                    className="bg-app-bg border border-app-border hover:border-app-text/30 rounded-xl p-3 space-y-2 transition-all flex flex-col"
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-1.5 max-w-[80%] min-w-0">
                                                            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono font-bold shrink-0 ${typeColor}`}>
                                                                {typeLabel}
                                                            </span>
                                                            <span className="font-bold text-xs text-app-text truncate" title={item.name}>
                                                                {displayName}
                                                            </span>
                                                        </div>

                                                        <div className="flex items-center gap-1">
                                                            {onDeleteMIPrOMPT && (
                                                                <button 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (true) {
                                                                            onDeleteMIPrOMPT(item.id);
                                                                        }
                                                                    }}
                                                                    className="p-1 hover:bg-red-500/10 text-app-dim hover:text-red-400 rounded transition-colors"
                                                                    title="Delete Prompt"
                                                                >
                                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                    </svg>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <p className="text-xs text-app-dim select-text line-clamp-3 overflow-hidden leading-relaxed font-sans bg-black/20 p-2 rounded-lg border border-app-border/40 whitespace-pre-wrap">
                                                        {item.content}
                                                    </p>

                                                    <div className="flex items-center justify-between pt-1 border-t border-app-border/40">
                                                        <span className="text-[9px] text-app-dim/50 font-mono">
                                                            {new Date(item.createdAt).toLocaleDateString()}
                                                        </span>
                                                        <div className="flex items-center gap-1.5">
                                                            {/* Replace */}
                                                            <button 
                                                                onClick={() => {
                                                                    setBuilderInput(item.content);
                                                                    setSelectedTemplate(null);
                                                                }}
                                                                className="text-[10px] font-bold px-2 py-1 bg-app-panel text-app-text border border-app-border hover:border-app-text hover:bg-app-bg transition-all rounded"
                                                                title="Replace active input with this prompt"
                                                            >
                                                                Replace
                                                            </button>

                                                            {/* Append */}
                                                            <button 
                                                                onClick={() => {
                                                                    setBuilderInput(curr => curr ? `${curr}\n\n${item.content}` : item.content);
                                                                    setSelectedTemplate(null);
                                                                }}
                                                                className="text-[10px] font-bold px-2 py-1 bg-gradient-to-r from-blue-600/30 to-purple-600/30 text-blue-300 hover:text-white border border-blue-500/20 hover:border-blue-500/40 rounded transition-all"
                                                                title="Append this prompt to active input"
                                                            >
                                                                + Append
                                                            </button>

                                                            {/* Copy */}
                                                            <button 
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText(item.content);
                                                                    setCopiedMipromptId(item.id);
                                                                    setTimeout(() => setCopiedMipromptId(null), 1500);
                                                                }}
                                                                className={`text-[10px] font-bold px-2 py-1 rounded transition-all ${copiedMipromptId === item.id ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-app-panel text-app-dim border-app-border hover:text-app-text hover:bg-app-bg'}`}
                                                                title="Copy content to clipboard"
                                                            >
                                                                {copiedMipromptId === item.id ? 'Copied' : 'Copy'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>
                </div>
            )}
          </div>
        )}

        {/* History Modal */}
        {showHistory && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
                <div className="bg-app-panel border border-app-border rounded-2xl p-6 w-full max-w-lg shadow-2xl animate-scale-in max-h-[80vh] flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-bold text-app-text flex items-center gap-2">
                            <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Podcast History
                        </h3>
                        <button onClick={() => setShowHistory(false)} className="text-app-dim hover:text-app-text">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                        {globalPodcastHistory.length === 0 ? (
                            <div className="text-center py-10 text-app-dim border-2 border-dashed border-app-border rounded-xl">
                                <p>No generated podcasts found.</p>
                            </div>
                        ) : (
                            globalPodcastHistory.map(item => (
                                <div 
                                    key={item.id}
                                    className="w-full p-3 bg-app-bg border border-app-border rounded-xl flex items-center justify-between gap-3 group transition-all"
                                >
                                    {editingItemId === item.id ? (
                                        <div className="flex-1 flex items-center gap-2">
                                            <input 
                                                type="text"
                                                value={editItemName}
                                                onChange={(e) => setEditItemName(e.target.value)}
                                                className="flex-1 bg-app-input border border-purple-500 rounded px-2 py-1 text-sm text-app-text focus:outline-none"
                                                autoFocus
                                            />
                                            <button 
                                                onClick={() => {
                                                    if (editItemName.trim() && onRenameMediaItem) {
                                                        onRenameMediaItem(item.id, editItemName.trim());
                                                    }
                                                    setEditingItemId(null);
                                                }}
                                                className="px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold rounded transition-colors"
                                            >
                                                Save
                                            </button>
                                            <button 
                                                onClick={() => setEditingItemId(null)}
                                                className="px-2 py-1 bg-app-card hover:bg-app-border text-app-dim text-[10px] font-bold rounded transition-colors"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <button 
                                                onClick={() => handleHistoryItemClick(item)}
                                                className="flex-1 flex items-center gap-3 text-left min-w-0"
                                            >
                                                <div className="w-10 h-10 shrink-0 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400 group-hover:bg-purple-500 group-hover:text-white transition-colors">
                                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="font-bold text-app-text truncate text-sm">{item.name || (item as any).title || 'Untitled Audio'}</h4>
                                                    <p className="text-[10px] text-app-dim">
                                                        {(item as any).file ? new Date((item as any).file.lastModified).toLocaleString() : 'Saved Audio'}
                                                    </p>
                                                </div>
                                            </button>
                                            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button 
                                                    onClick={() => {
                                                        setEditingItemId(item.id);
                                                        setEditItemName(item.name || '');
                                                    }}
                                                    className="p-1.5 text-app-dim hover:text-purple-400 hover:bg-purple-500/10 rounded transition-colors"
                                                    title="Rename"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        if (deleteConfirmId === item.id) {
                                                            if (onRemoveMediaItem) onRemoveMediaItem(item.id);
                                                            setDeleteConfirmId(null);
                                                        } else {
                                                            setDeleteConfirmId(item.id);
                                                        }
                                                    }}
                                                    className={`p-1.5 rounded transition-all ${deleteConfirmId === item.id ? 'text-red-400 bg-red-500/20 font-bold px-2 animate-pulse scale-105' : 'text-app-dim hover:text-red-400 hover:bg-red-500/10'}`}
                                                    title={deleteConfirmId === item.id ? "Click again to confirm delete" : "Delete"}
                                                >
                                                    {deleteConfirmId === item.id ? (
                                                        <span className="text-[10px] uppercase tracking-wider font-extrabold text-red-500">Confirm?</span>
                                                    ) : (
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    )}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Prompt Library Modal */}
        {showPrompts && (
            <PromptLibraryModal 
                isOpen={showPrompts} 
                onClose={() => setShowPrompts(false)}
                prompts={prompts}
                onSelect={(content) => {
                    if (activeTool === 'podcast_creator') {
                        setPodcastCustomInput(prev => (prev ? `${prev}\n${content}` : content));
                        setShowPrompts(false);
                    }
                }}
                onAdd={onAddPrompt}
                onDelete={onDeletePrompt}
            />
        )}

        
        {isCastLibraryOpen && (
            <CastLibraryModal
                isOpen={isCastLibraryOpen}
                onClose={() => setIsCastLibraryOpen(false)}
                castLibrary={castLibrary}
                voiceSettings={voiceSettings}
                onResetVoiceSettings={() => {
                    const { voiceSettings: nextVoiceSettings, touchedRoles: nextTouched } =
                      buildStaggeredDefaultVoiceSettings(voiceSettings, castLibrary);
                    setTouchedRoles(nextTouched);
                    onUpdateVoiceSettings(nextVoiceSettings);
                }}
                onAssignRole={(role, member) => {
                    const updates: Partial<VoiceSettings> = {};
                    const isAlreadyAssigned = touchedRoles.includes(role) && (
                        (role === 'host' && voiceSettings.hostMemberId === member.id) ||
                        (role === 'expert' && voiceSettings.expertMemberId === member.id) ||
                        (role === 'guest' && voiceSettings.guestMemberId === member.id)
                    );
                    
                    if (isAlreadyAssigned) {
                        setTouchedRoles(prev => prev.filter(r => r !== role));
                        if (role === 'host') {
                            updates.host = 'Puck';
                            updates.hostLabel = 'Sax';
                            updates.hostBio = 'A charismatic and engaging host who guides the conversation.';
                            updates.hostAvatar = undefined;
                            updates.hostMemberId = undefined;
                        } else if (role === 'expert') {
                            updates.expert = 'Kore';
                            updates.expertLabel = 'Chameleon';
                            updates.expertBio = 'A knowledgeable subject matter expert who provides deep insights.';
                            updates.expertAvatar = undefined;
                            updates.expertMemberId = undefined;
                        } else if (role === 'guest') {
                            updates.guest = 'Fenrir';
                            updates.guestLabel = 'The Pinpoint';
                            updates.guestBio = 'A special guest with a unique perspective.';
                            updates.guestAvatar = undefined;
                            updates.guestMemberId = undefined;
                        }
                    } else {
                        setTouchedRoles(prev => (prev.includes(role) ? prev : [...prev, role]));
                        if (role === 'host') {
                            updates.host = member.voice;
                            updates.hostLabel = member.name;
                            updates.hostBio = member.bio;
                            updates.hostAvatar = member.avatar;
                            updates.hostMemberId = member.id;
                        } else if (role === 'expert') {
                            updates.expert = member.voice;
                            updates.expertLabel = member.name;
                            updates.expertBio = member.bio;
                            updates.expertAvatar = member.avatar;
                            updates.expertMemberId = member.id;
                        } else if (role === 'guest') {
                            updates.guest = member.voice;
                            updates.guestLabel = member.name;
                            updates.guestBio = member.bio;
                            updates.guestAvatar = member.avatar;
                            updates.guestMemberId = member.id;
                        }
                    }
                    onUpdateVoiceSettings({ ...voiceSettings, ...updates });
                }}
                onAdd={onAddCastMember}
                onUpdate={onUpdateCastMember}
                onDelete={onDeleteCastMember}
            />
        )}
      </div>
    
      
    
      <ToolOrderSettingsModal
        isOpen={isToolSettingsOpen}
        onClose={() => setIsToolSettingsOpen(false)}
        tools={tools}
        toolOrder={toolOrder}
        onSave={handleSaveOrder}
      />
</div>
  );
};

export default OfficeTools;
