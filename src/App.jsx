import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, doc, onSnapshot, setDoc, runTransaction 
} from 'firebase/firestore';
import { 
  Calendar, Users, AlertCircle, CheckCircle, 
  Clock, ShieldAlert, UserCheck, Coffee, Sun, Moon, Link, Download
} from 'lucide-react';

// ==========================================
// 🔧 系統核心設定 (每次開新更表只需修改這裡！)
// ==========================================
const SCHEDULE_START_DATE = '2026-07-06'; // 格式: YYYY-MM-DD
const PERIOD_ID = `period_${SCHEDULE_START_DATE}`; // Firebase 資料庫的獨立 ID

// ==========================================
// 1. Firebase 初始化
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAzpCd6l3gWkQ92u2tyQCucO7IAYsqX4gw",
  authDomain: "vcc-shift-schedule.firebaseapp.com",
  projectId: "vcc-shift-schedule",
  storageBucket: "vcc-shift-schedule.firebasestorage.app",
  messagingSenderId: "278697903697",
  appId: "1:278697903697:web:24851b0ff640f3a37c5a70"
};

// 安全初始化 (防止重複初始化)
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'default-shift-app'; // 固定一個應用程式 ID

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

const generateEmptySchedule = () => {
  return Array.from({ length: 14 }, (_, i) => ({
    dayId: i + 1, AM: [], PM: [], OFF: []
  }));
};

export default function App() {
  const [user, setUser] = useState(null);
  const [scheduleData, setScheduleData] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // UI 狀態
  const [currentUser, setCurrentUser] = useState(EMPLOYEES[0].id); 
  const [viewMode, setViewMode] = useState('supervisor'); // 預設主管視角
  const [isUrlLocked, setIsUrlLocked] = useState(false);  // 是否被 URL 強制鎖定
  const [toast, setToast] = useState({ show: false, msg: '', type: 'info' });
  const [processing, setProcessing] = useState(false);

  // ==========================================
  // 3. 網址偵測與身份驗證
  // ==========================================
  useEffect(() => {
    // 偵測網址參數 (例如: ?uid=emp_1)
    const params = new URLSearchParams(window.location.search);
    const uidParam = params.get('uid');
    
    if (uidParam && EMPLOYEES.some(e => e.id === uidParam)) {
        setCurrentUser(uidParam);
        setIsUrlLocked(true);      // 鎖死身分，不能切換
        setViewMode('employee');   // 強制進入員工模式
    } else {
        setViewMode('supervisor'); // 沒有網址參數，進入主管模式
    }

    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        showToast("登入系統失敗，請重試", "error");
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 訂閱雲端更表資料
  useEffect(() => {
    if (!user) return;

    // 使用 PERIOD_ID，每次改日期都會自動開一個新的獨立資料庫
    const scheduleRef = doc(db, 'artifacts', appId, 'public', 'data', 'schedules', PERIOD_ID);

    const unsubscribe = onSnapshot(scheduleRef, 
      (docSnap) => {
        if (docSnap.exists()) {
          setScheduleData(docSnap.data().days);
        } else {
          const emptySchedule = generateEmptySchedule();
          setScheduleData(emptySchedule);
          setDoc(scheduleRef, { days: emptySchedule });
        }
        setLoading(false);
      },
      (error) => {
        showToast("無法讀取更表資料，請檢查網絡", "error");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // ==========================================
  // 4. 輔助功能與邏輯
  // ==========================================
  const showToast = (msg, type = 'info') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast({ show: false, msg: '', type: 'info' }), 3000);
  };

  const getEmpName = (id) => EMPLOYEES.find(e => e.id === id)?.name || id;

  // 計算並轉換真實日期顯示
  const getDisplayDate = (dayOffset) => {
    const date = new Date(SCHEDULE_START_DATE);
    date.setDate(date.getDate() + dayOffset);
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return `${date.getMonth() + 1}月${date.getDate()}日 (${weekdays[date.getDay()]})`;
  };

  // 複製專屬連結功能
  const copyPersonalLink = (empId) => {
    const link = `${window.location.origin}${window.location.pathname}?uid=${empId}`;
    try {
        const el = document.createElement('textarea');
        el.value = link;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        showToast(`已複製 ${getEmpName(empId)} 的專屬連結！`);
    } catch(e) {
        showToast("複製失敗，請手動複製", "error");
    }
  };

  // ★ 新增功能：匯出成 Excel (CSV)
  const exportToExcel = () => {
    if (!scheduleData || scheduleData.length === 0) {
      showToast("沒有更表資料可匯出", "error");
      return;
    }

    // 加入 \uFEFF 是為了讓 Excel 正確識別 UTF-8 編碼，防止中文字變亂碼
    let csvContent = "\uFEFF"; 
    csvContent += "日期,早更 (AM),夜更 (PM),放假 (OFF)\n";

    scheduleData.forEach((day, index) => {
      const dateStr = getDisplayDate(index);
      
      // 將員工 ID 轉為名字，並用「、」連接
      const amStr = day.AM.map(id => getEmpName(id)).join('、');
      const pmStr = day.PM.map(id => getEmpName(id)).join('、');
      const offStr = day.OFF.map(id => getEmpName(id)).join('、');

      // 加上雙引號，避免名字中有逗號影響 CSV 格式
      csvContent += `"${dateStr}","${amStr}","${pmStr}","${offStr}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // 建立一個隱藏的 <a> 標籤觸發下載
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `排更表_${SCHEDULE_START_DATE}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("成功匯出更表！");
  };

  const workerStats = useMemo(() => {
    if (!scheduleData || !Array.isArray(scheduleData)) return { workDays: 0, offDays: 0 };
    let workDays = 0, offDays = 0;
    scheduleData.forEach(day => {
      if (day.AM.includes(currentUser) || day.PM.includes(currentUser)) workDays++;
      if (day.OFF.includes(currentUser)) offDays++;
    });
    return { workDays, offDays };
  }, [scheduleData, currentUser]);

  const handleShiftClick = async (dayIndex, shiftType) => {
    if (viewMode === 'supervisor' || processing || !scheduleData) return;
    setProcessing(true);

    const scheduleRef = doc(db, 'artifacts', appId, 'public', 'data', 'schedules', PERIOD_ID);

    try {
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(scheduleRef);
        if (!sfDoc.exists()) throw new Error("更表未初始化");

        const data = sfDoc.data();
        const days = data.days;
        const currentDay = days[dayIndex];
        const isMe = currentDay[shiftType].includes(currentUser);

        let newDay = { ...currentDay, AM: [...currentDay.AM], PM: [...currentDay.PM], OFF: [...currentDay.OFF] };

        if (isMe) {
          newDay[shiftType] = newDay[shiftType].filter(id => id !== currentUser);
        } else {
          if (newDay[shiftType].length >= 4) {
            throw new Error(`該時段名額已滿 (最多4人)！`);
          }
          const isWorkingShift = shiftType === 'AM' || shiftType === 'PM';
          if (isWorkingShift) {
            let workingCount = 0;
            days.forEach((d, idx) => {
              if (idx !== dayIndex && (d.AM.includes(currentUser) || d.PM.includes(currentUser))) workingCount++;
            });
            if (workingCount >= 10) throw new Error("你已選滿 10 天工作日！請選擇放假 (OFF)。");
          }
          newDay.AM = newDay.AM.filter(id => id !== currentUser);
          newDay.PM = newDay.PM.filter(id => id !== currentUser);
          newDay.OFF = newDay.OFF.filter(id => id !== currentUser);
          newDay[shiftType].push(currentUser);
        }

        const newDays = [...days];
        newDays[dayIndex] = newDay;
        transaction.update(scheduleRef, { days: newDays });
      });
    } catch (error) {
      showToast(error.message || "更新失敗", "error");
    } finally {
      setProcessing(false);
    }
  };

  // ==========================================
  // 5. UI 渲染組件
  // ==========================================
  const renderShiftButton = (dayIndex, shiftType, config) => {
    const dayData = scheduleData[dayIndex];
    if (!dayData) return null;

    const shiftData = dayData[shiftType];
    const isFull = shiftData.length >= 4;
    const isShort = shiftType !== 'OFF' && shiftData.length < 3;
    const isMe = shiftData.includes(currentUser);
    const IconComponent = config.icon;

    let baseClass = "p-2 sm:p-3 rounded-xl border-2 text-sm flex flex-col items-center justify-center transition-all duration-200 min-h-[85px] sm:min-h-[90px] relative ";
    
    if (viewMode === 'supervisor') {
        baseClass += "bg-white cursor-default ";
        if (isShort) baseClass += "border-red-400 bg-red-50 ";
        else baseClass += "border-slate-200 ";
    } else {
        if (isMe) {
          baseClass += `${config.activeColor} shadow-md transform scale-[1.02] sm:scale-105 z-10`;
        } else if (isFull) {
          baseClass += "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-75";
        } else {
          baseClass += `bg-white border-slate-200 text-slate-700 ${config.hoverColor} cursor-pointer active:scale-95`;
        }
    }

    return (
      <div key={`${dayIndex}-${shiftType}`} className={baseClass} onClick={() => handleShiftClick(dayIndex, shiftType)}>
        <div className="flex items-center gap-1 font-bold mb-1 text-xs sm:text-sm">
          <IconComponent size={14} className={`sm:w-[16px] sm:h-[16px] ${config.iconColor}`} /> {config.label}
        </div>
        <div className="flex items-center gap-1 text-[10px] sm:text-xs mb-1 sm:mb-2">
          <Users size={12} />
          <span>{shiftData.length}/4</span>
        </div>
        
        {viewMode === 'supervisor' ? (
            <div className="text-[10px] sm:text-xs flex flex-wrap justify-center gap-1 w-full">
                {shiftData.map(id => (
                    <span key={id} className="bg-white border border-slate-200 px-1 py-0.5 rounded text-slate-700 shadow-sm leading-tight">
                      {getEmpName(id)}
                    </span>
                ))}
                {isShort && <span className="text-red-500 font-bold flex items-center justify-center w-full mt-1 bg-red-100 py-0.5 rounded leading-tight"><AlertCircle size={10} className="mr-0.5"/>欠 {3 - shiftData.length} 人</span>}
            </div>
        ) : (
            isMe && (
            <div className="absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 bg-emerald-500 text-white rounded-full p-0.5 sm:p-1 shadow-md">
                <CheckCircle size={14} />
            </div>
            )
        )}
      </div>
    );
  };

  if (loading || !user || !scheduleData || scheduleData.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-slate-500 text-sm animate-pulse">正在載入雲端更表...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-2 sm:p-4 md:p-8 font-sans pb-20">
      
      {toast.show && (
        <div className={`fixed top-4 right-4 sm:top-6 sm:right-6 z-50 p-3 sm:p-4 rounded-lg shadow-xl text-white text-sm sm:text-base font-medium flex items-center gap-2 ${toast.type === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`}>
          {toast.type === 'error' ? <ShieldAlert size={18}/> : <CheckCircle size={18}/>}
          {toast.msg}
        </div>
      )}

      <div className="max-w-7xl mx-auto">
        
        {/* Header - RWD 優化 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 mb-4 sm:mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="text-blue-600" size={24} />
              智能雲端排更系統
            </h1>
            <p className="text-slate-500 text-xs sm:text-sm mt-1.5 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              更表期數：{SCHEDULE_START_DATE} 開始 (14天)
            </p>
          </div>
          
          {/* 只有未被網址鎖定時 (主管視角) 才顯示切換按鈕 */}
          {!isUrlLocked && (
            <div className="flex flex-col gap-3 w-full md:w-auto">
              <div className="flex w-full items-center gap-1 sm:gap-2 bg-slate-100 p-1 rounded-lg border border-slate-200">
                  <button 
                      onClick={() => setViewMode('supervisor')}
                      className={`flex-1 md:flex-none px-3 py-2 rounded-md text-xs sm:text-sm font-bold transition-all ${viewMode === 'supervisor' ? 'bg-white shadow text-purple-600' : 'text-slate-500'}`}
                  >
                      主管視角
                  </button>
                  <button 
                      onClick={() => setViewMode('employee')}
                      className={`flex-1 md:flex-none px-3 py-2 rounded-md text-xs sm:text-sm font-bold transition-all ${viewMode === 'employee' ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}
                  >
                      員工模擬
                  </button>
              </div>

              {viewMode === 'employee' && (
                  <div className="flex items-center gap-2 justify-end">
                    <select 
                        className="w-full bg-white border border-slate-300 rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium text-blue-700"
                        value={currentUser}
                        onChange={(e) => setCurrentUser(e.target.value)}
                    >
                        {EMPLOYEES.map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.name}</option>
                        ))}
                    </select>
                  </div>
              )}
            </div>
          )}
        </div>

        {/* 主管專屬：派發連結與匯出 (只在主管模式顯示) */}
        {viewMode === 'supervisor' && !isUrlLocked && (
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-100 rounded-xl p-4 sm:p-5 mb-6 shadow-sm">
             <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 gap-3">
               <div className="flex items-center gap-2">
                 <Link size={20} className="text-purple-600" />
                 <h3 className="font-bold text-purple-900 text-sm sm:text-base">專屬連結及報表匯出</h3>
               </div>
               
               {/* 下載 Excel (CSV) 按鈕 */}
               <button 
                  onClick={exportToExcel}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white py-2 sm:py-1.5 px-4 sm:px-3 rounded-lg text-sm font-medium transition-colors shadow-sm"
               >
                 <Download size={16} /> 匯出更表 (Excel/CSV)
               </button>
             </div>
             
             <p className="text-xs sm:text-sm text-purple-700 mb-4">點擊以下按鈕複製專屬網址，透過 WhatsApp 傳送給同事。他們點擊後將會自動鎖定身分，無法切換或偷看主管頁面。</p>
             <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
               {EMPLOYEES.map(emp => (
                 <button 
                    key={`link-${emp.id}`}
                    onClick={() => copyPersonalLink(emp.id)}
                    className="bg-white hover:bg-purple-100 border border-purple-200 text-purple-700 py-2 px-2 rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-sm text-center"
                 >
                   複製 {emp.name}
                 </button>
               ))}
             </div>
          </div>
        )}

        {/* 員工專屬數據面板 */}
        {viewMode === 'employee' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div className="bg-white border-l-4 border-blue-500 shadow-sm rounded-r-xl p-3 sm:p-5 flex items-center gap-3 sm:gap-4">
                    <div className="bg-blue-50 p-2 sm:p-3 rounded-full text-blue-600 hidden sm:block">
                      <UserCheck size={24} />
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm font-semibold text-slate-500 mb-0.5">當前操作者</p>
                      <p className="text-lg sm:text-xl font-bold text-slate-800">{getEmpName(currentUser)}</p>
                    </div>
                </div>
                <div className="bg-white border-l-4 border-indigo-500 shadow-sm rounded-r-xl p-3 sm:p-5 flex items-center gap-3 sm:gap-4 relative overflow-hidden">
                    <div className="bg-indigo-50 p-2 sm:p-3 rounded-full text-indigo-600 hidden sm:block">
                      <Clock size={24} />
                    </div>
                    <div className="z-10">
                      <p className="text-xs sm:text-sm font-semibold text-slate-500 mb-0.5">工作日 (目標: 10日)</p>
                      <p className="text-lg sm:text-2xl font-bold text-slate-800">
                          {workerStats.workDays} <span className="text-xs sm:text-base font-medium text-slate-400">/ 10</span>
                      </p>
                    </div>
                    {workerStats.workDays === 10 && <div className="absolute right-3 sm:right-4 text-indigo-500 font-bold bg-indigo-50 px-2 py-1 rounded text-xs sm:text-sm border border-indigo-100">已達標</div>}
                </div>
                <div className="bg-white border-l-4 border-emerald-500 shadow-sm rounded-r-xl p-3 sm:p-5 flex items-center gap-3 sm:gap-4">
                    <div className="bg-emerald-50 p-2 sm:p-3 rounded-full text-emerald-600 hidden sm:block">
                      <Coffee size={24} />
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm font-semibold text-slate-500 mb-0.5">放假 OFF (目標: 4日)</p>
                      <p className="text-lg sm:text-2xl font-bold text-slate-800">
                        {workerStats.offDays} <span className="text-xs sm:text-base font-medium text-slate-400">/ 4</span>
                      </p>
                    </div>
                </div>
            </div>
        )}

        {/* 互動式更表 Grid (RWD 完全重寫：手機雙欄，平板四欄，桌面七欄) */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-sm border border-slate-200 p-3 sm:p-6">
          
          {[0, 1].map(weekIndex => (
            <div key={`week-${weekIndex}`} className="mb-8 sm:mb-10 last:mb-0">
              <div className="flex items-center gap-2 mb-3 sm:mb-4 bg-slate-50 p-2 rounded-lg border border-slate-100">
                <h3 className="text-base sm:text-lg font-bold text-slate-800 pl-2">第 {weekIndex + 1} 週</h3>
              </div>
              
              {/* RWD 關鍵: grid-cols-2 手機版變兩欄 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
                
                {Array.from({ length: 7 }, (_, dayOffset) => {
                  const dayIndex = (weekIndex * 7) + dayOffset;
                  return (
                    <div key={`day-${dayIndex}`} className="flex flex-col gap-2 sm:gap-2.5 bg-slate-50 p-2 sm:p-2.5 rounded-xl border border-slate-100 hover:border-slate-300 transition-colors">
                      <div className="text-center font-bold text-slate-700 bg-white py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm border border-slate-200 shadow-sm">
                        {getDisplayDate(dayIndex)}
                      </div>
                      
                      {renderShiftButton(dayIndex, 'AM', {
                        label: '早(AM)', icon: Sun, iconColor: 'text-amber-500',
                        activeColor: 'bg-blue-600 border-blue-600 text-white', hoverColor: 'hover:border-blue-400 hover:bg-blue-50'
                      })}
                      {renderShiftButton(dayIndex, 'PM', {
                        label: '夜(PM)', icon: Moon, iconColor: 'text-indigo-500',
                        activeColor: 'bg-indigo-600 border-indigo-600 text-white', hoverColor: 'hover:border-indigo-400 hover:bg-indigo-50'
                      })}
                      {renderShiftButton(dayIndex, 'OFF', {
                        label: '假(OFF)', icon: Coffee, iconColor: 'text-emerald-500',
                        activeColor: 'bg-emerald-500 border-emerald-500 text-white', hoverColor: 'hover:border-emerald-400 hover:bg-emerald-50'
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
  );
}
