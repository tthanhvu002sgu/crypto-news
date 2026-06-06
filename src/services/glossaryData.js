export const glossaryData = [
  {
    id: 'funding-rate',
    term: 'Funding Rate (Phí tài trợ)',
    category: 'derivatives',
    categoryLabel: 'Phái sinh',
    definition: 'Khoản phí định kỳ mà các nhà giao dịch giữ vị thế Long (Mua) hoặc Short (Bán) thanh toán cho nhau trong thị trường hợp đồng tương lai vĩnh cửu (Perpetual Futures) sau mỗi 8 giờ. Cơ chế này giúp giá Futures không bị lệch quá xa so với giá thực tế ngoài thị trường giao ngay (Spot).',
    example: 'Nếu Funding Rate hiển thị là +0.05% (dương), nghĩa là phe Long đang quá hưng phấn và áp đảo. Nếu bạn mở lệnh Long trị giá 10,000 USDT, bạn phải trả 5 USDT phí cho phe Short sau mỗi 8 giờ. Ngược lại, nếu Funding âm (-0.02%), phe Short đang đông hơn và họ phải trả 2 USDT cho phe Long.'
  },
  {
    id: 'open-interest',
    term: 'Open Interest - OI (Vị thế mở)',
    category: 'derivatives',
    categoryLabel: 'Phái sinh',
    definition: 'Tổng giá trị hoặc số lượng hợp đồng tương lai (Futures) đang hoạt động, chưa được thanh toán hoặc đóng lại trên thị trường. Chỉ số này đo lường tổng lượng tiền đang thực sự "đặt cược" trên sàn phái sinh.',
    example: 'Nếu Open Interest của BTC tăng mạnh từ 100K BTC lên 120K BTC trong khi giá BTC đang tăng nhanh, chứng tỏ có lượng lớn dòng tiền mới đổ vào để mở vị thế Long mới, giúp củng cố đà tăng. Nhưng nếu OI tăng quá cao, thị trường sẽ trở nên cực kỳ nhạy cảm và dễ biến động mạnh.'
  },
  {
    id: 'long-short-ratio',
    term: 'Tỷ lệ Long/Short (L/S Ratio)',
    category: 'derivatives',
    categoryLabel: 'Phái sinh',
    definition: 'Tỷ lệ so sánh giữa số lượng tài khoản đang giữ vị thế Long (kỳ vọng giá lên) và vị thế Short (kỳ vọng giá xuống) trên sàn giao dịch. Nó phản ánh tâm lý của số đông nhà giao dịch cá nhân.',
    example: 'Tỷ lệ Long/Short là 2.5 nghĩa là cứ 1 người Short thì có tới 2.5 người Long. Khi tỷ lệ này quá cao (trên 2.0) và nghiêng về phe Long, điều đó báo hiệu thị trường đang quá tải đòn bẩy Mua. Market Maker có xu hướng kéo giá đi xuống để quét sạch phe này (quét Long).'
  },
  {
    id: 'leverage',
    term: 'Leverage (Đòn bẩy)',
    category: 'derivatives',
    categoryLabel: 'Phái sinh',
    definition: 'Công cụ cho phép bạn mượn vốn từ sàn giao dịch để tăng quy mô vị thế giao dịch của mình lên gấp nhiều lần so với số vốn tự có, nhằm tối ưu hóa lợi nhuận nhưng cũng phóng đại mức độ rủi ro thua lỗ.',
    example: 'Bạn có 1,000 USDT vốn tự có. Bạn chọn đòn bẩy 10x để mở lệnh Long BTC trị giá 10,000 USDT. Nếu giá BTC tăng 1%, bạn kiếm được 100 USDT (tương đương 10% lợi nhuận trên vốn gốc). Tuy nhiên, nếu giá giảm chỉ 10%, bạn sẽ mất sạch 1,000 USDT vốn ban đầu (bị cháy tài khoản).'
  },
  {
    id: 'liquidation',
    term: 'Liquidation (Thanh lý vị thế)',
    category: 'derivatives',
    categoryLabel: 'Phái sinh',
    definition: 'Trạng thái sàn giao dịch tự động đóng và bán tháo vị thế phái sinh của bạn khi tài sản ký quỹ của bạn không còn đủ để bù đắp khoản lỗ do thị trường đi ngược lại dự đoán của bạn.',
    example: 'Bạn Long BTC ở mức giá $90,000 với đòn bẩy 20x. Điểm thanh lý (Liquidation Price) của bạn sẽ nằm quanh mức $85,500. Nếu giá BTC sụt giảm chạm mức $85,500, sàn sẽ lập tức đóng lệnh của bạn và số tiền ký quỹ ban đầu sẽ biến mất hoàn toàn.'
  },
  {
    id: 'short-squeeze',
    term: 'Short Squeeze (Bóp Short)',
    category: 'derivatives',
    categoryLabel: 'Phái sinh',
    definition: 'Hiện tượng giá của một tài sản đột ngột tăng vọt lên rất mạnh, buộc những người đang mở vị thế Short (bán khống) phải mua lại tài sản ở mức giá cao để đóng lệnh cắt lỗ hoặc bị thanh lý cưỡng bức, từ đó tạo thêm lực mua cực lớn đẩy giá lên cao hơn nữa.',
    example: 'Khi rất nhiều nhà giao dịch đặt lệnh Short BTC ở giá $90,000 với mức cắt lỗ tự động tại $91,000. Một cá voi lớn bất ngờ kích hoạt lực mua mạnh đẩy giá lên $91,200. Hàng loạt lệnh cắt lỗ của phe Short bị kích hoạt dưới dạng lệnh Mua, đẩy giá vọt lên $93,000 chỉ trong vài phút.'
  },
  {
    id: 'spot-vs-futures',
    term: 'Spot vs Futures (Giao ngay vs Tương lai)',
    category: 'derivatives',
    categoryLabel: 'Phái sinh',
    definition: 'Spot (Giao ngay) là mua bán tài sản thực và nhận sở hữu chúng ngay lập tức. Futures (Hợp đồng tương lai) là mua bán các hợp đồng thỏa thuận về giá trị của tài sản đó, không sở hữu tài sản gốc mà chỉ kiếm lời/lỗ dựa trên chênh lệch giá.',
    example: 'Nếu bạn mua 1 BTC trên thị trường Spot, bạn thực sự sở hữu nó và có thể rút về ví lạnh cất giữ trọn đời. Nhưng nếu bạn mua 1 BTC Futures, bạn chỉ giữ một hợp đồng cược giá BTC tăng. Lệnh Futures có thể bị thanh lý nếu giá giảm sâu, còn BTC Spot thì không bao giờ bị thanh lý cho dù giá giảm thế nào.'
  },
  {
    id: 'divergence',
    term: 'Divergence (Phân kỳ kỹ thuật)',
    category: 'derivatives',
    categoryLabel: 'Phái sinh',
    definition: 'Sự mâu thuẫn giữa đường đi của giá tài sản và đường đi của một chỉ báo kỹ thuật (như RSI, MACD hoặc Open Interest). Nó là dấu hiệu cảnh báo xu hướng hiện tại đang yếu đi và sắp có sự đảo chiều mạnh.',
    example: 'Giá BTC tiếp tục tăng và lập đỉnh mới (ví dụ từ $92,000 lên $95,000), nhưng chỉ số Open Interest (OI) lại liên tục giảm dần trong cùng khoảng thời gian. Đây gọi là phân kỳ giảm giá phái sinh, báo hiệu đà tăng không có dòng tiền mới chống đỡ và rủi ro đảo chiều giảm giá là rất cao.'
  },
  {
    id: 'cascade-liquidation',
    term: 'Cascade Liquidation (Thanh lý dây chuyền)',
    category: 'derivatives',
    categoryLabel: 'Phái sinh',
    definition: 'Phản ứng dây chuyền xảy ra khi một đợt biến động mạnh kích hoạt thanh lý hàng loạt vị thế đòn bẩy cao, đẩy giá đi tiếp sang vùng thanh lý mới, kích hoạt tiếp đợt thanh lý đòn bẩy thấp hơn. Hiện tượng này tạo nên những cột nến rút râu thẳng đứng.',
    example: 'BTC giảm nhẹ từ $90,000 xuống $88,000 kích hoạt thanh lý phe Long 50x. Sàn buộc phải bán lượng BTC này ra thị trường, đẩy giá xuống tiếp $86,000. Mức giá này kích hoạt thanh lý tiếp phe Long 20x, tiếp tục ép giá xuống $83,000 để quét phe 10x. Kết quả là giá rơi tự do tạo ra một "thác thanh lý".'
  },
  {
    id: 'dxy',
    term: 'DXY (Chỉ số Đô la Mỹ)',
    category: 'macro',
    categoryLabel: 'Vĩ mô',
    definition: 'Chỉ số đo lường sức mạnh của đồng USD so với một rổ gồm 6 loại ngoại tệ lớn khác trên thế giới (chủ yếu là Euro, Yên Nhật, Bảng Anh). DXY được ví như thước đo "sức khỏe" dòng tiền fiat toàn cầu.',
    example: 'Khi chỉ số DXY tăng mạnh (từ 101 lên 105), đồng USD đang mạnh lên, lãi suất USD có thể đang cao. Nhà đầu tư có xu hướng bán các tài sản rủi ro như Cổ phiếu, Vàng hay Crypto để giữ USD lấy lãi suất an toàn. Vì vậy, DXY tăng thường đi kèm với việc thị trường Crypto điều chỉnh giảm.'
  },
  {
    id: 'treasury-yield',
    term: '10Y Treasury Yield (Lợi suất trái phiếu Mỹ 10 năm)',
    category: 'macro',
    categoryLabel: 'Vĩ mô',
    definition: 'Mức lãi suất thực tế mà chính phủ Mỹ cam kết trả cho những người mua trái phiếu kỳ hạn 10 năm của họ. Đây được coi là lãi suất quy chuẩn "không rủi ro" lớn nhất thế giới.',
    example: 'Lợi suất trái phiếu 10 năm tăng lên mức cao kỷ lục 4.8%/năm. Các quỹ đầu tư lớn nhận thấy việc gửi tiền cho chính phủ Mỹ vừa an toàn tuyệt đối vừa sinh lời tốt, họ quyết định rút bớt vốn khỏi cổ phiếu công nghệ và Bitcoin để mua trái phiếu. Dòng tiền bị hút đi khiến thị trường crypto thiếu thanh khoản.'
  },
  {
    id: 'm2-money-supply',
    term: 'M2 Money Supply (Cung tiền M2)',
    category: 'macro',
    categoryLabel: 'Vĩ mô',
    definition: 'Tổng lượng tiền tệ đang lưu thông trong nền kinh tế, bao gồm tiền mặt, tiền gửi ngân hàng, các quỹ tiết kiệm và quỹ thị trường tiền tệ. Cung tiền M2 càng lớn chứng tỏ lượng tiền mặt ngoài thị trường càng nhiều.',
    example: 'Trong đại dịch COVID-19, Ngân hàng Trung ương Mỹ (FED) bơm tiền hỗ trợ nền kinh tế, khiến cung tiền M2 toàn cầu tăng vọt. Lượng tiền mặt dư thừa không có nơi trú ẩn đã chảy mạnh vào thị trường chứng khoán và crypto, đẩy giá BTC tăng vọt từ $10,000 lên mức $69,000.'
  },
  {
    id: 'fed-funds-rate',
    term: 'Fed Funds Rate (Lãi suất liên bang FED)',
    category: 'macro',
    categoryLabel: 'Vĩ mô',
    definition: 'Mức lãi suất mục tiêu do Ngân hàng Trung ương Mỹ (FED) ấn định để các ngân hàng thương mại vay mượn lẫn nhau qua đêm. Đây là nút thắt điều chỉnh van bơm/hút tiền của nền kinh tế thế giới.',
    example: 'Để kiềm chế lạm phát, FED tăng lãi suất từ 0.25% lên 5.25%. Chi phí đi vay của các doanh nghiệp trở nên đắt đỏ hơn, người dân thắt lưng buộc bụng, dòng tiền đầu tư rủi ro co hẹp lại. Đây là lý do chính khiến thị trường crypto bước vào giai đoạn ngủ đông (Dowtrend/Crypto Winter) năm 2022.'
  },
  {
    id: 'qt-vs-qe',
    term: 'QT vs QE (Hút tiền vs Bơm tiền)',
    category: 'macro',
    categoryLabel: 'Vĩ mô',
    definition: 'QE (Quantitative Easing - Nới lỏng định lượng) là việc FED in tiền để mua tài sản, bơm tiền vào nền kinh tế. QT (Quantitative Tightening - Thắt chặt định lượng) là việc FED bán tài sản hoặc để tài sản tự đáo hạn nhằm thu hồi tiền mặt về, hút bớt thanh khoản ra khỏi thị trường.',
    example: 'Khi FED thực hiện QE (bơm tiền), thị trường ngập tràn thanh khoản và tài sản tăng giá. Khi FED thông báo thực hiện QT (hút tiền) với quy mô $95 tỷ mỗi tháng, dòng tiền dần cạn kiệt, các quỹ đầu tư buộc phải bán bớt các tài sản có tính đầu cơ cao như Altcoin để bảo toàn tiền mặt.'
  },
  {
    id: 'stablecoin-cap',
    term: 'Stablecoin Market Cap (Vốn hóa Stablecoin)',
    category: 'onchain',
    categoryLabel: 'On-chain & Stablecoin',
    definition: 'Tổng vốn hóa thị trường của tất cả các đồng tiền ổn định neo giá theo USD (như USDT, USDC). Nó đóng vai trò là lượng "nước" trong hồ chứa crypto, phản ánh sức mua trực tiếp của các nhà đầu tư.',
    example: 'Mặc dù giá BTC đi ngang, nhưng dữ liệu cho thấy tổng vốn hóa USDT tăng thêm 3 tỷ USD chỉ trong 1 tuần. Đây là tín hiệu cho thấy các nhà đầu tư đang chuyển tiền fiat (tiền mặt ngoài đời) thành stablecoin và nạp lên sàn. Lượng "thuốc súng" này đã sẵn sàng để mua gom tài sản, báo hiệu sắp có lực mua đẩy giá lên.'
  },
  {
    id: 'onchain-data',
    term: 'On-chain Data (Dữ liệu trên chuỗi)',
    category: 'onchain',
    categoryLabel: 'On-chain & Stablecoin',
    definition: 'Tất cả các dữ liệu giao dịch được ghi nhận công khai trực tiếp trên mạng lưới blockchain (như chuyển tiền của cá voi, số lượng địa chỉ ví mới hoạt động, lượng coin nạp/rút khỏi các sàn giao dịch).',
    example: 'Dữ liệu On-chain ghi nhận 50,000 BTC được rút từ sàn Binance về các ví lạnh lưu trữ dài hạn trong ngày hôm qua. Hành động rút coin này chứng tỏ cá voi đang muốn nắm giữ lâu dài thay vì để trên sàn để bán, làm giảm nguồn cung bán tháo trên sàn, là tín hiệu tích cực cho giá.'
  },
  {
    id: 'btc-dominance',
    term: 'BTC Dominance - BTC.D (Thị phần Bitcoin)',
    category: 'onchain',
    categoryLabel: 'On-chain & Stablecoin',
    definition: 'Tỷ lệ phần trăm vốn hóa của Bitcoin so với tổng vốn hóa của toàn bộ thị trường tiền điện tử. Chỉ số này phản ánh dòng tiền đang tập trung vào Bitcoin (an toàn) hay Altcoin (rủi ro).',
    example: 'BTC.D tăng từ 50% lên 57% cho thấy nhà đầu tư đang bán Altcoin để chuyển sang giữ Bitcoin do lo ngại thị trường bất ổn (xu hướng Risk-Off). Ngược lại, nếu BTC.D giảm mạnh trong khi tổng vốn hóa thị trường tăng, đó là báo hiệu dòng tiền đang đổ mạnh vào Altcoin (mùa Altcoin / Altseason).'
  },
  {
    id: 'dry-powder',
    term: 'Dry Powder (Sức mua dự trữ / Thuốc súng khô)',
    category: 'onchain',
    categoryLabel: 'On-chain & Stablecoin',
    definition: 'Khái niệm chỉ lượng tiền mặt hoặc Stablecoin đang được giữ ở trạng thái sẵn sàng, chưa giải ngân mua tài sản. Nó là lượng thanh khoản chực chờ để gom hàng khi thị trường xuất hiện những đợt sập giá (panic sell).',
    example: 'Một quỹ đầu tư phân bổ danh mục: 70% BTC và 30% USDT. 30% USDT này được gọi là "Dry Powder". Khi giá BTC bất ngờ sập 15% trong đêm do tin tức xấu, họ lập tức giải ngân lượng "thuốc súng" này để mua gom BTC với giá chiết khấu rẻ.'
  },
  {
    id: 'fear-greed-index',
    term: 'Fear & Greed Index (Chỉ số Sợ hãi & Tham lam)',
    category: 'sentiment',
    categoryLabel: 'Tâm lý',
    definition: 'Chỉ số đo lường tâm lý chung của thị trường crypto theo thang điểm từ 0 đến 100. Điểm số càng thấp (dưới 25) thể hiện thị trường đang cực kỳ sợ hãi, điểm số càng cao (trên 75) thể hiện thị trường đang quá hưng phấn và tham lam.',
    example: 'Khi chỉ số đạt mức 15 (Cực kỳ sợ hãi), đa số nhà đầu tư nhỏ lẻ đang hoảng loạn bán tháo cắt lỗ. Về mặt lịch sử, đây thường là vùng đáy và là cơ hội mua vào tốt nhất. Ngược lại, khi chỉ số lên mức 88 (Cực kỳ tham lam), thị trường sắp đạt đỉnh và dễ có những cú sập điều chỉnh.'
  },
  {
    id: 'smart-vs-retail',
    term: 'Smart Money vs Retail (Tiền thông minh vs Nhỏ lẻ)',
    category: 'sentiment',
    categoryLabel: 'Tâm lý',
    definition: 'Smart Money (Tiền thông minh) đại diện cho các tổ chức tài chính lớn, quỹ đầu tư, Market Maker sở hữu nguồn vốn lớn và thông tin sắc bén. Retail (Nhỏ lẻ) đại diện cho đám đông nhà đầu tư cá nhân, thường giao dịch theo cảm xúc và tin tức truyền thông.',
    example: 'Tại vùng giá đáy cực kỳ sợ hãi, dữ liệu ghi nhận ví của các quỹ lớn liên tục gom hàng (Smart Money tích lũy), trong khi số lượng tài khoản nhỏ lẻ liên tục bán tháo cắt lỗ (Retail hoảng loạn). Ở vùng đỉnh hưng phấn, Retail tranh nhau mua đuổi (FOMO) còn Smart Money thì âm thầm bán chốt lời từ từ.'
  },
  {
    id: 'market-maker',
    term: 'Market Maker - MM (Nhà tạo lập thị trường)',
    category: 'sentiment',
    categoryLabel: 'Tâm lý',
    definition: 'Các tổ chức lớn đứng ra tạo thanh khoản cho thị trường bằng cách liên tục đặt lệnh mua và bán cùng lúc ở các mức giá khác nhau. Họ giúp người mua và người bán bình thường có thể giao dịch lập tức mà không bị chênh lệch giá quá lớn.',
    example: 'Nếu không có MM, khi bạn muốn bán 100 BTC, bạn có thể phải chấp nhận bán giá rẻ hơn 5% vì không có đủ người mua trực tiếp ở giá hiện tại. MM đứng ra đặt lệnh mua sẵn ở sát giá thị trường, giúp bạn bán khớp lệnh ngay lập tức mà vẫn được giá tốt.'
  },
  {
    id: 'socratic-matrix',
    term: 'Socratic Matrix (Ma trận phản biện Socratic)',
    category: 'sentiment',
    categoryLabel: 'Tâm lý',
    definition: 'Phương pháp tư duy biện chứng, đối chiếu góc nhìn của số đông (Retail) với góc nhìn logic của nhà cái/tổ chức lớn (Smart Money) dựa trên dữ liệu thực tế. Giúp nhà đầu tư tránh bẫy tâm lý và tìm kiếm sự thật phi cảm xúc.',
    example: 'Đám đông thấy giá BTC tăng mạnh liền giải thích: "Thị trường sắp uptrend, nhảy vào mua thôi!". Ma trận phản biện kiểm tra thấy Open Interest tăng vọt nhưng Funding Rate siêu cao. Phản biện Socratic chỉ ra: "Giá tăng do đẩy phái sinh Long quá đà, phe Long đang chịu phí cao không bền, đây là bẫy dụ thanh khoản để MM xả hàng".'
  }
];
