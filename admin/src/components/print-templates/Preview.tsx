interface PreviewProps {
  text: string;
}

export default function Preview({ text }: PreviewProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-[#f7f2e8] p-6 shadow-sm">
      <div className="mx-auto max-w-[340px] rounded-xl bg-[#fffdf8] px-5 py-6 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-[#2a2a2a]">{text}</pre>
      </div>
    </div>
  );
}
