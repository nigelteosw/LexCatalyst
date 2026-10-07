import { Dialog } from '../../shared/ui/Dialog'

// Draft terms for demonstration sessions. Each clause must stay true to what the
// code does (OpenRouter / OpenAI / Cloudflare R2 processing); have counsel review
// before wider use.
const CLAUSES: { heading: string; body: string[] }[] = [
  {
    heading: 'Nature of the Demonstration',
    body: [
      'LexCatalyst (the “Platform”) is made available solely as a pre-release demonstration for evaluation purposes (the “Demonstration”). The Platform is provided “as is” and “as available”, without warranty of any kind, whether express or implied.',
      'Nothing produced by the Platform, including any output, summary, citation, draft or suggestion, constitutes legal advice or should be relied upon as such. All output must be independently verified.',
    ],
  },
  {
    heading: 'No Confidential or Personal Data',
    body: [
      'You undertake not to upload, enter, paste or otherwise submit to the Platform any personal data, client information, privileged or confidential material, or any information you are not free to disclose. Only synthetic or non-confidential material may be used.',
      'You are solely responsible for any information you submit in breach of this clause.',
    ],
  },
  {
    heading: 'Use of Data',
    body: [
      'Content submitted during the Demonstration is used only to operate the Platform’s features for you during the Demonstration. It is not used for advertising or promotion, is not sold or licensed to any third party, and is not used by us to train or fine-tune any artificial intelligence model.',
    ],
  },
  {
    heading: 'Third-Party Processing',
    body: [
      'To provide its features, the Platform transmits prompts and excerpts of submitted content to OpenRouter and the model provider you or the Platform selects (for language-model responses), and to OpenAI (for embeddings). Uploaded files are stored with Cloudflare.',
      'These third parties process data under their own terms and retention practices, which we do not control. Searches of public Singapore judgments send only a short search phrase to the eLitigation service.',
    ],
  },
  {
    heading: 'Retention and Deletion',
    body: [
      'Demonstration data may be reset, altered or deleted at any time without notice. You should not expect any content to be retained or recoverable.',
    ],
  },
  {
    heading: 'No Solicitation or Engagement',
    body: [
      'Participation in the Demonstration creates no solicitor-client, fiduciary or other professional relationship, and no obligation on either party to enter into any further agreement or purchase. Your details will not be used for marketing or promotional communications by reason of your participation.',
    ],
  },
  {
    heading: 'Disclaimer and Limitation of Liability',
    body: [
      'To the fullest extent permitted by law, the LexCatalyst team excludes all liability for any loss or damage of any kind arising out of or in connection with your use of the Platform, including any loss arising from reliance on its output, and any indirect or consequential loss.',
    ],
  },
  {
    heading: 'Changes and Termination',
    body: [
      'We may modify these terms, or suspend or withdraw access to the Platform, at any time without notice or liability.',
    ],
  },
  {
    heading: 'Governing Law',
    body: [
      'These terms are governed by the laws of Singapore. The parties submit to the non-exclusive jurisdiction of the courts of Singapore.',
    ],
  },
]

export function DemoTermsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog bodyClassName="p-5" className="max-w-2xl" onClose={onClose} title="Demo Terms">
      <p className="text-sm leading-relaxed text-neutral-600">
        By ticking the box on the sign-in page and accessing the Platform, you agree to the following terms.
      </p>
      <ol className="mt-4 space-y-4">
        {CLAUSES.map((clause, i) => (
          <li key={clause.heading}>
            <h3 className="text-sm font-semibold text-neutral-900">
              {i + 1}. {clause.heading}
            </h3>
            {clause.body.map((text, j) => (
              <p key={j} className="mt-1.5 text-sm leading-relaxed text-neutral-600">
                {i + 1}.{j + 1} {text}
              </p>
            ))}
          </li>
        ))}
      </ol>
    </Dialog>
  )
}
