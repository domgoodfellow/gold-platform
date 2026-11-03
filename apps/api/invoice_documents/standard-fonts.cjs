// The PDF layout draws with the PDF standard fonts, which pdfkit loads at run time through its own
// `#standard-fonts/*` import map. A deployed function contains only the files a tracer can see, and
// none can follow that, so each font is named here. `require.resolve` only locates a file; nothing
// loads until pdfkit asks for it. apps/api pins the pdfkit version @react-pdf/font pins, so these
// are the very files pdfkit opens (`invoice-document-writer.test.ts` holds the two together).
require.resolve('pdfkit/standard-fonts/Courier');
require.resolve('pdfkit/standard-fonts/CourierBold');
require.resolve('pdfkit/standard-fonts/CourierBoldOblique');
require.resolve('pdfkit/standard-fonts/CourierOblique');
require.resolve('pdfkit/standard-fonts/Helvetica');
require.resolve('pdfkit/standard-fonts/HelveticaBold');
require.resolve('pdfkit/standard-fonts/HelveticaBoldOblique');
require.resolve('pdfkit/standard-fonts/HelveticaOblique');
require.resolve('pdfkit/standard-fonts/Symbol');
require.resolve('pdfkit/standard-fonts/TimesBold');
require.resolve('pdfkit/standard-fonts/TimesBoldItalic');
require.resolve('pdfkit/standard-fonts/TimesItalic');
require.resolve('pdfkit/standard-fonts/TimesRoman');
require.resolve('pdfkit/standard-fonts/ZapfDingbats');
