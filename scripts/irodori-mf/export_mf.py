#!/usr/bin/env python3
"""Experimental MF export using ngc-shj/irodori-tts-webgpu's MIT exporter.

Pass --webgpu-source <checkout>, then export_v4.py's normal arguments.
No modification is made to either upstream checkout. Requires a pinned MF checkpoint.
"""
import sys
from pathlib import Path
import torch
from torch.export import Dim

VERIFY_ONLY = '--verify-only' in sys.argv
if VERIFY_ONLY:
    sys.argv.remove('--verify-only')


class MeanFlowDiT(torch.nn.Module):
    def __init__(self, model, half):
        super().__init__()
        self.model = model
        self.half = half

    def forward(self, x_t, t, delta_t, text_state, text_mask, speaker_state, speaker_mask, caption_state, caption_mask):
        if self.half:
            x_t, t, delta_t = x_t.half(), t.half(), delta_t.half()
            text_state, speaker_state, caption_state = text_state.half(), speaker_state.half(), caption_state.half()
        return self.model.forward_with_encoded_conditions(
            x_t=x_t, t=t, delta_t=delta_t,
            text_state=text_state, text_mask=text_mask,
            speaker_state=speaker_state, speaker_mask=speaker_mask,
            caption_state=caption_state, caption_mask=caption_mask,
            latent_mask=None, context_kv_cache=None,
        ).float()


def export_dit(model, cfg, out_dir, *, half, verify):
    if cfg.flow_parameterization != 'meanflow':
        raise ValueError('Refusing to export a non-MeanFlow checkpoint as MF')
    wrapper = MeanFlowDiT(model, half).eval()
    torch.manual_seed(42)
    base = exporter._dit_inputs(cfg)
    inputs = (*base[:2], torch.full_like(base[1], 0.25), *base[2:])
    names = ['x_t', 't', 'delta_t', 'text_state', 'text_mask', 'speaker_state', 'speaker_mask', 'caption_state', 'caption_mask']
    b, s, st, sp, sc = [Dim(n) for n in ('b', 's', 'st', 'sp', 'sc')]
    dynamic = dict(zip(names, [{0:b,1:s},{0:b},{0:b},{0:b,1:st},{0:b,1:st},{0:b,1:sp},{0:b,1:sp},{0:b,1:sc},{0:b,1:sc}]))
    with torch.inference_mode():
        reference = wrapper(*inputs)
    # Upstream's SDPA plan casts query_len to int, specializing the latent
    # dimension during export. Keep the symbolic dimension; CPU export never
    # uses the CUDA-only FA3 packing branch.
    import irodori_tts.model as model_module
    from irodori_tts.attention import ContextAttentionPlan
    original_plan = model_module.build_context_attention_plan
    def symbolic_plan(segment_masks, *, query_len, attention_dtype):
        mask = segment_masks[0] if len(segment_masks) == 1 else torch.cat(segment_masks, dim=1)
        return ContextAttentionPlan(kv_mask=mask, query_len=query_len, use_fa3=False)
    model_module.build_context_attention_plan = symbolic_plan
    target = out_dir / 'dit_v4_mf.onnx'
    try:
        if not VERIFY_ONLY:
            torch.onnx.export(wrapper, inputs, str(target), input_names=names, output_names=['v'], dynamic_shapes=dynamic, opset_version=18, dynamo=True)
    finally:
        model_module.build_context_attention_plan = original_plan
    if verify:
        exporter._verify(target, dict(zip(names, [v.numpy() for v in inputs])), reference, 'v')
        import onnxruntime as ort
        import numpy as np
        session = ort.InferenceSession(str(target), providers=['CPUExecutionProvider'])
        failures = []
        for length in (17, 40, 62, 128):
            varied = [v[:1].clone() for v in inputs]
            varied[0] = torch.randn(1, length, cfg.patched_latent_dim)
            with torch.inference_mode():
                expected = wrapper(*varied).numpy()
            actual = session.run(['v'], dict(zip(names, [v.numpy() for v in varied])))[0]
            print(f'[verify] dynamic latent={length}, max_abs={np.max(np.abs(actual-expected)):.6f}, mean_abs={np.mean(np.abs(actual-expected)):.6f}', flush=True)
            try:
                np.testing.assert_allclose(actual, expected, atol=0.05, rtol=0.05)
            except AssertionError:
                failures.append(length)
        if failures:
            raise AssertionError(f'Dynamic numerical parity failed for lengths {failures}')
    print(f'[export] MeanFlow DiT: {target}', flush=True)


if __name__ == '__main__':
    index = sys.argv.index('--webgpu-source')
    root = Path(sys.argv[index + 1]).resolve()
    del sys.argv[index:index+2]
    sys.path.insert(0, str(root / 'export'))
    import export_v4 as exporter
    exporter.export_dit = export_dit
    exporter.main()
