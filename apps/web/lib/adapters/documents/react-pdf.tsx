import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { DocumentFont, DocumentRenderer, InvoiceDocument } from './index';

/**
 * The built-in invoice layout. The three brand font choices map onto the PDF standard families every
 * reader carries, so nothing is downloaded or embedded at render time and no business-supplied font
 * is ever loaded. Those families cover Western European text, English and French included.
 */
const FAMILY: Record<DocumentFont, string> = { sans: 'Helvetica', serif: 'Times-Roman', mono: 'Courier' };
const INK = '#1a1a1a';
const MUTED = '#5c5c5c';
const RULE = '#d4d4d4';

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 64, paddingHorizontal: 48, fontSize: 10, color: INK },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  sellerHead: { maxWidth: '55%' },
  logo: { maxWidth: 180, maxHeight: 56, objectFit: 'contain', marginBottom: 6 },
  sellerName: { fontSize: 16 },
  title: { fontSize: 22, textAlign: 'right', marginBottom: 6 },
  facts: { alignItems: 'flex-end' },
  fact: { flexDirection: 'row', marginBottom: 2 },
  factLabel: { color: MUTED, marginRight: 8 },
  parties: { flexDirection: 'row', marginBottom: 20 },
  party: { width: '50%', paddingRight: 16 },
  partyHeading: { fontSize: 8, color: MUTED, textTransform: 'uppercase', marginBottom: 4, letterSpacing: 0.6 },
  muted: { color: MUTED },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1.5, paddingBottom: 4, marginBottom: 2 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 5 },
  description: { width: '52%', paddingRight: 8 },
  quantity: { width: '12%', textAlign: 'right' },
  unit: { width: '18%', textAlign: 'right' },
  amount: { width: '18%', textAlign: 'right' },
  headCell: { fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  totals: { marginTop: 10, alignSelf: 'flex-end', width: '50%' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1.5, paddingTop: 6 },
  totalValue: { fontSize: 13 },
  section: { marginTop: 24 },
  sectionHeading: { fontSize: 11, marginBottom: 6 },
  footer: { position: 'absolute', bottom: 28, left: 48, right: 48, fontSize: 8, color: MUTED },
  // No line height is set anywhere: this layout engine multiplies it oddly and drops a render-prop text under an inherited one.
  pageNumber: { position: 'absolute', bottom: 28, right: 48, width: 120, textAlign: 'right', fontSize: 8, color: MUTED },
  draftMark: { position: 'absolute', top: 330, left: 0, right: 0, textAlign: 'center', fontSize: 96, color: '#e5e5e5', transform: 'rotate(-30deg)' },
});

function InvoicePdf({ document: doc }: { document: InvoiceDocument }) {
  const heading = { fontFamily: FAMILY[doc.brand.headingFont], fontWeight: 'bold' as const };
  const body = { fontFamily: FAMILY[doc.brand.bodyFont] };
  const accent = doc.brand.accent ?? INK;
  const draft = doc.status === 'draft';
  const tableHead = (
    <View fixed style={[styles.tableHead, { borderBottomColor: accent }]}>
      <Text style={[styles.headCell, styles.description]}>Description</Text>
      <Text style={[styles.headCell, styles.quantity]}>Qty</Text>
      <Text style={[styles.headCell, styles.unit]}>Unit price</Text>
      <Text style={[styles.headCell, styles.amount]}>Amount</Text>
    </View>
  );
  return (
    <Document title={doc.title} author={doc.seller.name} creator={doc.seller.name} producer={doc.seller.name}>
      <Page size="A4" style={[styles.page, body]}>
        {draft ? <Text fixed style={[styles.draftMark, heading]}>DRAFT</Text> : null}
        <Text fixed style={[styles.footer, { textAlign: 'left' }]}>{draft ? 'Draft — not an issued invoice' : doc.title}</Text>
        <Text fixed style={styles.pageNumber} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        <View style={styles.header}>
          <View style={styles.sellerHead}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- a drawing in a PDF, not an HTML image; the seller's name is written beside it under From. */}
            {doc.logo ? <Image style={styles.logo} src={{ data: Buffer.from(doc.logo.bytes), format: doc.logo.format }} /> : null}
            {doc.logo ? null : <Text style={[styles.sellerName, heading, { color: accent }]}>{doc.seller.tradingName ?? doc.seller.name}</Text>}
          </View>
          <View style={styles.facts}>
            <Text style={[styles.title, heading, { color: accent }]}>{draft ? 'Draft invoice' : 'Invoice'}</Text>
            {doc.facts.map((fact) => (
              <View key={fact.label} style={styles.fact}>
                <Text style={styles.factLabel}>{fact.label}</Text><Text>{fact.value}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.partyHeading}>From</Text>
            <Text style={heading}>{doc.seller.name}</Text>
            {doc.seller.tradingName ? <Text style={styles.muted}>Trading as {doc.seller.tradingName}</Text> : null}
            {[...doc.seller.addressLines, ...doc.seller.contactLines].map((line, index) => <Text key={index}>{line}</Text>)}
          </View>
          <View style={styles.party}>
            <Text style={styles.partyHeading}>Bill to</Text>
            <Text style={heading}>{doc.billTo.name}</Text>
            {doc.billTo.detailLines.map((line, index) => <Text key={index}>{line}</Text>)}
          </View>
        </View>
        <View>
          {/* Fixed, so it repeats at the top of every page the table continues onto. */}
          {tableHead}
          {doc.lines.map((line, index) => (
            <View key={index} style={styles.row} wrap={false}>
              <Text style={styles.description}>{line.description}</Text>
              <Text style={styles.quantity}>{line.quantity}</Text>
              <Text style={styles.unit}>{line.unitAmount}</Text>
              <Text style={styles.amount}>{line.amount}</Text>
            </View>
          ))}
          <View style={styles.totals} wrap={false}>
            <View style={[styles.totalRow, { borderTopColor: accent }]}>
              <Text style={heading}>{doc.total.label}</Text>
              <Text style={[styles.totalValue, heading]}>{doc.total.value}</Text>
            </View>
          </View>
        </View>
        {doc.notes.length ? (
          <View style={styles.section}>
            {doc.notes.map((note, index) => <Text key={index} style={styles.muted}>{note}</Text>)}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

export const reactPdfRenderer: DocumentRenderer = {
  version: 'invoice-standard-2',
  async renderInvoice(document) {
    return new Uint8Array(await renderToBuffer(<InvoicePdf document={document} />));
  },
};
