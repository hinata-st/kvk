import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
// evxl 那套界面的正文字体。打包进项目，不依赖 Google Fonts（国内经常连不上）
import '@fontsource/baloo-da-2/latin-400.css';
import '@fontsource/baloo-da-2/latin-700.css';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
