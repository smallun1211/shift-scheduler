import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  onSnapshot, 
  setDoc, 
  runTransaction 
} from 'firebase/firestore';
import { 
  Calendar, Users, AlertCircle, CheckCircle, 
  Clock, ShieldAlert, UserCheck, Coffee, Sun, Moon, Link, Lock, Unlock, Download, Sparkles, X, Plane 
} from 'lucide-react';

// ==========================================
// 1. Firebase 初始化與環境設置
// ==========================================
const fallbackConfig = {
  apiKey: "AIzaSyAzpCd6l3gWkQ92u2tyQCucO7IAYsqX4gw",
  authDomain: "vcc-shift-schedule.firebaseapp.com",
  projectId: "vcc-shift-schedule",
  storageBucket: "vcc-shift-schedule.firebasestorage.app",
  messagingSenderId: "278697903697",
  appId: "1:278697903697:web:24851b0ff640f3a37c5a70"
};

const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config
  ? JSON.parse(__firebase_config) 
  : fallbackConfig;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 智能環境切換
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-shift-app';

// ==========================================
// 🔧 系統核心設定 (每次開新更表只需修改這裡！)
// ==========================================
const SCHEDULE_START_DATE = '2026-09-14'; // 👈👈👈 修改日期就在這裡！！
const PERIOD_ID = `period_${SCHEDULE_START_DATE}`; 

const EMPLOYEES = [
  { id: 'emp_1', name: 'KCKB' },
  { id: 'emp_2', name: 'KFW' },
  { id: 'emp_3', name: 'CCKR' },
  { id: 'emp_4', name: 'HMC' },
  { id: 'emp_5', name: 'PL' },
  { id: 'emp_6', name: 'CPY' },
  { id: 'emp_7', name: 'RH' },
  { id: 'emp_8', name: 'FHW' },
  { id: 'emp_9', name: 'CTW' },
  { id: 'emp_10', name: 'LHF' }
];

// 生成 14 天空白更表結構 (加入 AL)
const generateEmptySchedule = () => {
  return Array.from({ length: 14 }, (_, i) => ({
    dayId: i + 1, AM: [], PM: [], OFF: [], AL: []
  }));
};

export default function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const uidFromUrl = urlParams.get('uid');
  const validEmp = EMPLOYEES.find(e => e.id === uidFromUrl);

  const [user, setUser] = useState(null);
  const [scheduleData, setScheduleData] = useState(null);
  const [isScheduleLocked, setIsScheduleLocked] = useState(false); 
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null); 
  
  const [currentUser, setCurrentUser] = useState(validEmp ? validEmp.id : EMPLOYEES[0].id); 
  const [isLockedIdentity] = useState(!!validEmp); 
  const [viewMode, setViewMode] = useState(validEmp ? 'employee' : 'supervisor'); 
  const [toast, setToast] = useState({ show: false, msg: '', type: 'info' });
  const [processing, setProcessing] = useState(false); 

  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiReport, setAiReport] = useState(null);

  // ==========================================
  // 2. 身份驗證與資料訂閱
  // ==========================================
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error:", err);
        setDbError("系統登入失敗，請檢查網絡連線。");
        setLoading(false);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const scheduleRef = doc(db, 'artifacts', appId, 'public', 'data', 'schedules', PERIOD_ID);

    const unsubscribe = onSnapshot(scheduleRef, 
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setScheduleData(data.days);
          setIsScheduleLocked(!!data.isLocked); 
        } else {
          const emptySchedule = generateEmptySchedule();
          setScheduleData(emptySchedule);
          setDoc(scheduleRef, { days: emptySchedule, isLocked: false });
        }
        setDbError(null); 
        setLoading(false);
      },
      (error) => {
        console.error("Firestore Subscribe Error:", error);
        if (error.code === 'permission-denied') {
            setDbError("Firebase 權限不足或過期 (Permission Denied)。請主管登入 Firebase Console 更新 Firestore Rules。");
        } else {
            setDbError(`無法讀取更表資料 (${error.message})`);
        }
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // ==========================================
  // 3. 商業邏輯
  // ==========================================
  const showToast = (msg, type = 'info') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast({ show: false, msg: '', type: 'info' }), 3000);
  };

  const getShiftCapacity = (dayIndex, shiftType) => {
    if (shiftType === 'AL') return 1; // AL 限制 1 人
    if (shiftType === 'OFF') return 3; // OFF 由 4 人改為限制 3 人
    if (shiftType === 'PM') return 3;  // PM 限制 3 人
    return 4; // AM 限制 4 人
  };

  const workerStats = useMemo(() => {
    if (!scheduleData || !Array.isArray(scheduleData)) return { workDays: 0, offDays: 0 };
    let workDays = 0;
    let offDays = 0;
    scheduleData.forEach(day => {
      // 兼容舊數據，加上 ?. 防呆
      if (day.AM?.includes(currentUser) || day.PM?.includes(currentUser)) workDays++;
      if (day.OFF?.includes(currentUser) || day.AL?.includes(currentUser)) offDays++;
    });
    return { workDays, offDays };
  }, [scheduleData, currentUser]);

  const toggleScheduleLock = async (lockStatus) => {
    if (processing) return;
    setProcessing(true);
    const scheduleRef = doc(db, 'artifacts', appId, 'public', 'data', 'schedules', PERIOD_ID);
    
    try {
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(scheduleRef);
        if (!sfDoc.exists()) throw new Error("更表未初始化");
        transaction.update(scheduleRef, { isLocked: lockStatus });
      });
      showToast(lockStatus ? "已完成編更，同事無法再修改" : "已重開編更，同事可繼續選擇", "success");
    } catch (error) {
      showToast("操作失敗，請重試", "error");
    } finally {
      setProcessing(false);
    }
  };

  const handleShiftClick = async (dayIndex, shiftType) => {
    if (viewMode === 'supervisor' || processing || !scheduleData) return;
    
    if (isScheduleLocked && viewMode === 'employee') {
      showToast("更表已鎖定，現階段無法修改", "error");
      return;
    }

    setProcessing(true);
    const scheduleRef = doc(db, 'artifacts', appId, 'public', 'data', 'schedules', PERIOD_ID);

    try {
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(scheduleRef);
        if (!sfDoc.exists()) throw new Error("更表未初始化");

        const data = sfDoc.data();
        
        if (data.isLocked && viewMode === 'employee') {
           throw new Error("更表已由主管鎖定完成，無法修改。");
        }

        const days = data.days;
        const currentDay = days[dayIndex];
        
        // 兼容舊數據沒有 AL 的情況
        const shiftDataArray = currentDay[shiftType] || [];
        const isMe = shiftDataArray.includes(currentUser);
        const maxCapacity = getShiftCapacity(dayIndex, shiftType);

        // 建立新的一天物件，同時確保舊數據擁有所有陣列，避免 Crash
        let newDay = { 
            ...currentDay, 
            AM: [...(currentDay.AM || [])], 
            PM: [...(currentDay.PM || [])], 
            OFF: [...(currentDay.OFF || [])],
            AL: [...(currentDay.AL || [])]
        };

        if (isMe) {
          newDay[shiftType] = newDay[shiftType].filter(id => id !== currentUser);
        } else {
          if (newDay[shiftType].length >= maxCapacity) {
            throw new Error(`Day ${dayIndex + 1} 的 ${shiftType} 名額已滿 (最多${maxCapacity}人)！`);
          }

          const isWorkingShift = shiftType === 'AM' || shiftType === 'PM';
          if (isWorkingShift) {
            let workingCount = 0;
            days.forEach((d, idx) => {
              if (idx !== dayIndex && (d.AM?.includes(currentUser) || d.PM?.includes(currentUser))) {
                workingCount++;
              }
            });
            if (workingCount >= 10) throw new Error("你已經選滿 10 天工作日！請選擇放假 (OFF / AL)。");
          }

          // 互斥邏輯：選了其中一個，自動清空同日的其他選擇
          newDay.AM = newDay.AM.filter(id => id !== currentUser);
          newDay.PM = newDay.PM.filter(id => id !== currentUser);
          newDay.OFF = newDay.OFF.filter(id => id !== currentUser);
          newDay.AL = newDay.AL.filter(id => id !== currentUser);

          newDay[shiftType].push(currentUser);
        }

        const newDays = [...days];
        newDays[dayIndex] = newDay;
        transaction.update(scheduleRef, { days: newDays });
      });

    } catch (error) {
      showToast(error.message || "更新失敗，請重試", "error");
    } finally {
      setProcessing(false);
    }
  };

  const getEmpName = (id) => EMPLOYEES.find(e => e.id === id)?.name || id;

  const handleCopyLink = (emp) => {
    const baseUrl = window.location.origin + window.location.pathname;
    const shareLink = `${baseUrl}?uid=${emp.id}`;
    
    const textArea = document.createElement("textarea");
    textArea.value = shareLink;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        showToast(`已複製 ${emp.name} 的專屬連結！`, 'success');
      } else {
        showToast('複製失敗，請手動選取複製', 'error');
      }
    } catch (err) {
      console.error('Copy fallback failed', err);
      showToast('複製失敗，請手動選取複製', 'error');
    }
    document.body.removeChild(textArea);
  };

  const getDisplayDate = (dayOffset) => {
    const date = new Date(SCHEDULE_START_DATE.replace(/-/g, '/'));
    date.setDate(date.getDate() + dayOffset);
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return `${date.getMonth() + 1}月${date.getDate()}日 (${weekdays[date.getDay()]})`;
  };

  const exportToExcel = () => {
    if (!scheduleData) return;

    let csvContent = "\uFEFF"; 
    csvContent += "日期,早更 (AM),夜更 (PM),放假 (OFF),年假 (AL)\n";

    scheduleData.forEach((dayData, index) => {
      const dateStr = getDisplayDate(index);
      const amNames = (dayData.AM || []).map(getEmpName).join(" / ");
      const pmNames = (dayData.PM || []).map(getEmpName).join(" / ");
      const offNames = (dayData.OFF || []).map(getEmpName).join(" / ");
      const alNames = (dayData.AL || []).map(getEmpName).join(" / ");
      csvContent += `"${dateStr}","${amNames}","${pmNames}","${offNames}","${alNames}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `更表_${SCHEDULE_START_DATE}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast("已成功下載更表檔案", "success");
  };

  const analyzeScheduleWithAI = async () => {
    if (!scheduleData) return;
    setIsAiAnalyzing(true);
    setAiReport(null);
    
    const apiKey = ""; // 運行環境會自動提供 API 密鑰
    const model = "gemini-2.5-flash-preview-09-2025";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    let promptData = `請分析以下這份 ${SCHEDULE_START_DATE} 開始的 14 天員工排更表：\n\n`;
    scheduleData.forEach((day, index) => {
      const dateStr = getDisplayDate(index);
      const amNames = (day.AM || []).map(getEmpName).join(', ') || '無';
      const pmNames = (day.PM || []).map(getEmpName).join(', ') || '無';
      const offNames = (day.OFF || []).map(getEmpName).join(', ') || '無';
      const alNames = (day.AL || []).map(getEmpName).join(', ') || '無';
      promptData += `- ${dateStr}: 早更[${amNames}], 夜更[${pmNames}], 放假[${offNames}], 年假[${alNames}]\n`;
    });

    const systemInstruction = `
      你是一個專業的香港人力資源顧問。你的任務是分析提供的 14 天排更表，並給出具建設性的建議。
      請以流暢的繁體中文回答，並使用排版（如 bullet points 和 bold text）。
      請涵蓋以下 3 個範疇：
      1. 整體人力分佈評估 (例如：每日早夜更是否充足，有沒有特別短缺的日子)。
      2. 員工工作量公平性分析 (例如：是否有人連續工作太多天，或者週末放假不平均)。
      3. 具體改善建議 (提供 1-2 項實際建議給主管調整更表)。
    `;

    const payload = {
      contents: [{ parts: [{ text: promptData }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] }
    };

    const fetchWithRetry = async (url, options, retries = 5) => {
      const delays = [1000, 2000, 4000, 8000, 16000];
      for (let i = 0; i < retries; i++) {
        try {
          const response = await fetch(url, options);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response.json();
        } catch (err) {
          if (i === retries - 1) throw err;
          await new Promise(res => setTimeout(res, delays[i]));
        }
      }
    };

    try {
      const data = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "抱歉，無法生成分析報告。";
      setAiReport(text);
    } catch (error) {
      console.error("AI Analysis Error:", error);
      showToast("AI 分析失敗，請稍後再試", "error");
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  // ==========================================
  // 4. UI 渲染組件
  // ==========================================
  const renderShiftButton = (dayIndex, shiftType, config) => {
    const dayData = scheduleData[dayIndex];
    if (!dayData) return null;

    // ★ 舊數據防呆：如果舊數據沒有 AL，預設給它一個空陣列
    const shiftData = dayData[shiftType] || [];
    const maxCapacity = getShiftCapacity(dayIndex, shiftType);
    const isFull = shiftData.length >= maxCapacity;
    const isShort = (shiftType !== 'OFF' && shiftType !== 'AL') && shiftData.length < 3; 
    const isMe = shiftData.includes(currentUser);
    const IconComponent = config.icon;

    let baseClass = "p-3 rounded-xl border-2 text-sm flex flex-col items-center justify-center transition-all duration-200 min-h-[90px] relative ";
    
    if (viewMode === 'supervisor') {
        baseClass += "bg-white cursor-default ";
        if (isShort) baseClass += "border-red-400 bg-red-50 ";
        else baseClass += "border-gray-200 hover:border-gray-300 ";
    } else {
        if (isScheduleLocked) {
             if (isMe) {
                 baseClass += `${config.activeColor} shadow-md opacity-90 cursor-not-allowed`;
             } else {
                 baseClass += "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed opacity-60";
             }
        } else {
             if (isMe) {
               baseClass += `${config.activeColor} shadow-md transform scale-105 z-10`;
             } else if (isFull) {
               baseClass += "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed opacity-75";
             } else {
               baseClass += `bg-white border-gray-200 text-gray-700 ${config.hoverColor} cursor-pointer`;
             }
        }
    }

    return (
      <div 
        key={`${dayIndex}-${shiftType}`}
        className={baseClass}
        onClick={() => handleShiftClick(dayIndex, shiftType)}
      >
        <div className="flex items-center gap-1 font-bold mb-1">
          <IconComponent size={16} className={config.iconColor} /> {config.label}
        </div>
        <div className="flex items-center gap-1 text-xs mb-2">
          <Users size={14} />
          <span>{shiftData.length} / {maxCapacity}</span>
        </div>
        
        {viewMode === 'supervisor' ? (
            <div className="text-xs flex flex-wrap justify-center gap-1 w-full">
                {shiftData.map(id => (
                    <span key={id} className="bg-white border border-gray-100 px-1.5 py-0.5 rounded text-gray-700 shadow-sm">
                      {getEmpName(id)}
                    </span>
                ))}
                {isShort && <span className="text-red-500 font-bold flex items-center justify-center w-full mt-1 bg-red-100 py-0.5 rounded"><AlertCircle size={12} className="mr-1"/>欠 {3 - shiftData.length} 人</span>}
            </div>
        ) : (
            isMe && (
            <div className={`absolute -top-2 -right-2 ${isScheduleLocked ? 'bg-gray-500' : 'bg-green-500'} text-white rounded-full p-1 shadow`}>
                <CheckCircle size={16} />
            </div>
            )
        )}
      </div>
    );
  };

  const renderBasicHtml = (text) => {
    const htmlText = text.replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-800">$1</strong>').replace(/\n/g, '<br/>');
    return { __html: htmlText };
  };

  if (dbError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <div className="bg-white p-8 rounded-2xl shadow-lg border border-red-100 max-w-md w-full flex flex-col items-center">
          <ShieldAlert size={64} className="text-red-500 mb-6" />
          <h2 className="text-2xl font-bold text-slate-800 mb-2">系統連線中斷</h2>
          <p className="text-red-600 font-medium mb-6 bg-red-50 p-3 rounded-lg w-full">{dbError}</p>
          <div className="text-left text-sm text-slate-600 space-y-2 w-full">
            <p><strong>解決方法 (主管專用)：</strong></p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>登入 Firebase Console。</li>
              <li>進入 Firestore Database &gt; Rules (規則)。</li>
              <li>將規則更新為 <code>allow read, write: if request.auth != null;</code>。</li>
              <li>點擊發佈，然後重新整理此網頁。</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-gray-500 font-medium">系統連接中，請稍候...</p>
      </div>
    );
  }

  if (!scheduleData || scheduleData.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">正在準備更表資料，請稍候...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8 font-sans relative pb-10">
      
      {/* Toast */}
      {toast.show && (
        <div className={`fixed top-6 right-6 z-50 p-4 rounded-lg shadow-lg text-white font-medium flex items-center gap-2 transform transition-all duration-300 translate-y-0 ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
          {toast.type === 'error' ? <ShieldAlert size={20}/> : <CheckCircle size={20}/>}
          {toast.msg}
        </div>
      )}

      {/* AI 分析報告 Modal */}
      {aiReport && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-4 flex justify-between items-center text-white">
              <h3 className="font-bold flex items-center gap-2 text-lg"><Sparkles size={20} className="text-purple-200" /> AI 智能更表分析報告</h3>
              <button onClick={() => setAiReport(null)} className="hover:bg-white/20 p-1.5 rounded-full transition-colors"><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto custom-scrollbar text-slate-700 leading-relaxed text-sm">
               <div dangerouslySetInnerHTML={renderBasicHtml(aiReport)} />
            </div>
            <div className="bg-slate-50 border-t border-slate-100 p-4 flex justify-end">
              <button onClick={() => setAiReport(null)} className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg font-bold transition-colors">關閉報告</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto">
        
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="text-blue-600" />
              智能雲端排更系統
            </h1>
            <p className="text-slate-500 text-sm mt-1 flex items-center gap-1">
              <span className="relative flex h-2 w-2 mr-1">
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${isScheduleLocked ? 'bg-amber-400' : 'bg-green-400 animate-ping'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isScheduleLocked ? 'bg-amber-500' : 'bg-green-500'}`}></span>
              </span>
              更表期數: {SCHEDULE_START_DATE} | 狀態: {isScheduleLocked ? '🔒 已鎖定編更' : '🟢 選擇更份中'}
            </p>
          </div>
          
          <div className="flex flex-col gap-3 w-full md:w-auto">
            {!isLockedIdentity ? (
              <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-lg border border-slate-200">
                  <button 
                      onClick={() => setViewMode('employee')}
                      className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${viewMode === 'employee' ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                      同事選更模式
                  </button>
                  <button 
                      onClick={() => setViewMode('supervisor')}
                      className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${viewMode === 'supervisor' ? 'bg-white shadow text-purple-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                      主管全局檢視
                  </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-lg border border-slate-200">
                  <div className="px-4 py-2 rounded-md text-sm font-bold bg-white shadow text-blue-600">
                      同事選更模式
                  </div>
              </div>
            )}

            {viewMode === 'employee' && (
                <div className="flex items-center gap-2 justify-end">
                  <label className="text-sm font-medium text-slate-600">{isLockedIdentity ? "當前登入身分:" : "模擬登入身分:"}</label>
                  {isLockedIdentity ? (
                      <div className="bg-blue-50 border border-blue-200 px-4 py-2 rounded-md text-sm font-bold text-blue-700 shadow-sm">
                          {getEmpName(currentUser)}
                      </div>
                  ) : (
                      <select 
                          className="bg-white border border-slate-300 rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none cursor-pointer font-medium text-blue-700 shadow-sm"
                          value={currentUser}
                          onChange={(e) => setCurrentUser(e.target.value)}
                      >
                          {EMPLOYEES.map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.name}</option>
                          ))}
                      </select>
                  )}
                </div>
            )}
          </div>
        </div>

        {viewMode === 'employee' ? (
            <div className="space-y-4 mb-6">
                {isScheduleLocked && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl flex items-center gap-2 font-medium">
                        <Lock size={18} className="text-amber-600" />
                        主管已完成本次編更。更表已被鎖定，現階段無法再作更改。
                    </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white border-l-4 border-blue-500 shadow-sm rounded-r-xl p-5 flex items-center gap-4">
                        <div className="bg-blue-50 p-3 rounded-full text-blue-600">
                          <UserCheck size={28} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-500 mb-1">當前操作者</p>
                          <p className="text-xl font-bold text-slate-800">{getEmpName(currentUser)}</p>
                        </div>
                    </div>
                    <div className="bg-white border-l-4 border-emerald-500 shadow-sm rounded-r-xl p-5 flex items-center gap-4 relative overflow-hidden">
                        <div className="bg-emerald-50 p-3 rounded-full text-emerald-600">
                          <Clock size={28} />
                        </div>
                        <div className="z-10">
                          <p className="text-sm font-semibold text-slate-500 mb-1">已選工作天 (目標: 10日)</p>
                          <p className="text-2xl font-bold text-slate-800">
                              {workerStats.workDays} <span className="text-base font-medium text-slate-400">/ 10</span>
                          </p>
                        </div>
                        {workerStats.workDays === 10 && <div className="absolute right-4 text-emerald-500 font-bold bg-emerald-50 px-2 py-1 rounded text-sm">已達標</div>}
                    </div>
                    <div className="bg-white border-l-4 border-amber-500 shadow-sm rounded-r-xl p-5 flex items-center gap-4">
                        <div className="bg-amber-50 p-3 rounded-full text-amber-600">
                          <Coffee size={28} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-500 mb-1">已選放假 (OFF/AL) (目標: 4日)</p>
                          <p className="text-2xl font-bold text-slate-800">
                            {workerStats.offDays} <span className="text-base font-medium text-slate-400">/ 4</span>
                          </p>
                        </div>
                    </div>
                </div>
            </div>
        ) : (
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-100 shadow-sm rounded-xl p-5 mb-6 flex flex-col gap-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start md:items-center gap-4">
                        <div className="bg-white p-3 rounded-full text-purple-600 shadow-sm mt-1 md:mt-0">
                            <ShieldAlert size={28} />
                        </div>
                        <div>
                            <p className="text-lg font-bold text-purple-900 mb-1">主管全局視角與控制</p>
                            <p className="text-sm text-purple-700">紅色區塊表示該時段 <span className="font-bold underline">未達最低 3 人要求</span>。所有夜更上限已設定為 3 人。</p>
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-lg border border-purple-100 shadow-sm">
                        <button 
                           onClick={analyzeScheduleWithAI} 
                           disabled={isAiAnalyzing || !scheduleData}
                           className="flex items-center gap-1.5 px-4 py-2 rounded-md font-bold text-sm transition-all bg-purple-600 hover:bg-purple-700 text-white shadow relative overflow-hidden"
                        >
                           {isAiAnalyzing ? (
                             <>
                               <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                               <Sparkles size={16} className="animate-spin" /> 分析中...
                             </>
                           ) : (
                             <>
                               <Sparkles size={16} /> ✨ AI 分析
                             </>
                           )}
                        </button>
                        <button 
                           onClick={exportToExcel} 
                           disabled={processing || !scheduleData}
                           className="flex items-center gap-1.5 px-4 py-2 rounded-md font-bold text-sm transition-all bg-blue-500 hover:bg-blue-600 text-white shadow"
                        >
                           <Download size={16} /> 匯出 Excel
                        </button>
                        <button 
                           onClick={() => toggleScheduleLock(true)} 
                           disabled={isScheduleLocked || processing}
                           className={`flex items-center gap-1.5 px-4 py-2 rounded-md font-bold text-sm transition-all ${isScheduleLocked ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600 text-white shadow'}`}
                        >
                           <Lock size={16} /> 完成編更 (鎖定)
                        </button>
                        <button 
                           onClick={() => toggleScheduleLock(false)} 
                           disabled={!isScheduleLocked || processing}
                           className={`flex items-center gap-1.5 px-4 py-2 rounded-md font-bold text-sm transition-all ${!isScheduleLocked ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow'}`}
                        >
                           <Unlock size={16} /> 重開編更 (解鎖)
                        </button>
                    </div>
                </div>
                
                <div className="mt-2 bg-white/60 p-4 rounded-lg border border-purple-200">
                    <p className="text-sm font-bold text-purple-900 flex items-center gap-2 mb-3">
                        <Link size={16} /> 派發專屬連結 (點擊複製並經 WhatsApp 發送給同事)
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        {EMPLOYEES.map(emp => {
                            return (
                                <button 
                                    key={`link-${emp.id}`}
                                    onClick={() => handleCopyLink(emp)}
                                    className="text-left text-xs bg-white border border-purple-100 hover:border-purple-300 hover:bg-purple-50 p-2 rounded transition-colors"
                                >
                                    <span className="block font-bold text-purple-700">{emp.name}</span>
                                    <span className="block text-[10px] text-gray-400 truncate mt-0.5">點擊複製連結</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        )}

        {/* 互動式更表 Grid */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 overflow-x-auto">
          <div className="min-w-[1000px]">
            {[0, 1].map(weekIndex => (
              <div key={`week-${weekIndex}`} className="mb-10 last:mb-0">
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-xl font-bold text-slate-800">第 {weekIndex + 1} 週</h3>
                  <hr className="flex-grow border-slate-200 ml-4" />
                </div>
                
                <div className="grid grid-cols-7 gap-3">
                  {Array.from({ length: 7 }, (_, dayOffset) => {
                    const dayIndex = (weekIndex * 7) + dayOffset;
                    return (
                      <div key={`day-${dayIndex}`} className="flex flex-col gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
                        <div className="text-center font-bold text-slate-800 bg-white border border-slate-200 shadow-sm py-2 rounded-lg text-sm tracking-wider mb-1">
                          {getDisplayDate(dayIndex)}
                        </div>
                        
                        {renderShiftButton(dayIndex, 'AM', {
                          label: '早更 (AM)',
                          icon: Sun, 
                          iconColor: 'text-amber-500',
                          activeColor: 'bg-blue-600 border-blue-600 text-white',
                          hoverColor: 'hover:border-blue-400 hover:bg-blue-50'
                        })}

                        {renderShiftButton(dayIndex, 'PM', {
                          label: '夜更 (PM)',
                          icon: Moon, 
                          iconColor: 'text-indigo-500',
                          activeColor: 'bg-indigo-600 border-indigo-600 text-white',
                          hoverColor: 'hover:border-indigo-400 hover:bg-indigo-50'
                        })}

                        {/* ★ 修改：移除並排 grid，讓 OFF 與 AL 獨立上下排列防誤觸 */}
                        {renderShiftButton(dayIndex, 'OFF', {
                          label: '放假 (OFF)',
                          icon: Coffee, 
                          iconColor: 'text-emerald-500',
                          activeColor: 'bg-emerald-500 border-emerald-500 text-white',
                          hoverColor: 'hover:border-emerald-400 hover:bg-emerald-50'
                        })}

                        {renderShiftButton(dayIndex, 'AL', {
                          label: '年假 (AL)',
                          icon: Plane, 
                          iconColor: 'text-pink-500',
                          activeColor: 'bg-pink-500 border-pink-500 text-white',
                          hoverColor: 'hover:border-pink-400 hover:bg-pink-50'
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}