import React, { useState } from 'react';
import { glossaryData } from '../services/glossaryData';
import { Search, X, HelpCircle } from 'lucide-react';

export default function GlossaryTab() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');

  const categories = [
    { id: 'all', label: 'TẤT CẢ' },
    { id: 'derivatives', label: 'PHÁI SINH' },
    { id: 'macro', label: 'VĨ MÔ' },
    { id: 'onchain', label: 'ON-CHAIN' },
    { id: 'sentiment', label: 'TÂM LÝ' }
  ];

  const filteredData = glossaryData.filter(item => {
    const matchesCat = selectedCat === 'all' || item.category === selectedCat;
    const matchesSearch = 
      item.term.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.definition.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.example.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="glass-panel panel-section glossary-section">
      <div className="panel-header">
        <h3 className="panel-title font-mono text-emerald">
          <HelpCircle size={15} /> 📖 CẨM NANG THUẬT NGỮ &amp; ĐỊNH NGHĨA CHO NEWBIE
        </h3>
        <span className="panel-badge font-mono">{filteredData.length} thuật ngữ</span>
      </div>

      <p className="text-xs text-slate-400 mb-4" style={{ lineHeight: 1.7 }}>
        Giải nghĩa trực quan và thực chiến cho toàn bộ các chỉ số xuất hiện trên Terminal. Giúp nhà đầu tư mới tiếp cận luồng phân tích dòng tiền chuyên nghiệp, phi cảm xúc và nhận diện góc nhìn của Smart Money.
      </p>

      {/* Search and Filters Bar */}
      <div className="glossary-toolbar">
        <div className="glossary-search-container">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            className="glossary-search-input font-mono"
            placeholder="Tìm kiếm thuật ngữ, ví dụ hoặc giải nghĩa..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="search-clear-btn" onClick={() => setSearchTerm('')} title="Xóa tìm kiếm">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="glossary-categories font-mono">
          {categories.map(cat => (
            <button
              key={cat.id}
              className={`category-btn ${selectedCat === cat.id ? 'active' : ''}`}
              onClick={() => setSelectedCat(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table Area */}
      <div className="glossary-table-container">
        {filteredData.length > 0 ? (
          <table className="glossary-table">
            <thead>
              <tr>
                <th style={{ width: '180px' }}>THUẬT NGỮ</th>
                <th style={{ width: '110px' }}>PHÂN LOẠI</th>
                <th>GIẢI THÍCH ĐƠN GIẢN</th>
                <th>VÍ DỤ MINH HỌA THỰC TẾ</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((item) => (
                <tr key={item.id} className="glossary-row">
                  <td className="glossary-term font-mono">{item.term}</td>
                  <td>
                    <span className={`glossary-badge badge-${item.category} font-mono`}>
                      {item.categoryLabel}
                    </span>
                  </td>
                  <td className="glossary-def">{item.definition}</td>
                  <td className="glossary-ex-cell">
                    <div className="glossary-example-box">
                      <span className="example-tag font-mono">Ví dụ:</span> {item.example}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="glossary-empty-state font-mono">
            <p className="text-slate-500 mb-4">Không tìm thấy thuật ngữ phù hợp với từ khóa và danh mục đã chọn.</p>
            <button
              className="btn-clear-filters"
              onClick={() => {
                setSearchTerm('');
                setSelectedCat('all');
              }}
            >
              ĐẶT LẠI BỘ LỌC
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
