"""Two separate LoRAs. Default tiny CPU mode verifies plumbing, not visual quality."""
import argparse,json,time,hashlib,random,os
from contextlib import nullcontext
from pathlib import Path
import numpy as np
import torch
from PIL import Image,ImageOps
from diffusers import StableDiffusionPipeline,DDPMScheduler
from diffusers.utils import convert_state_dict_to_diffusers
from peft import LoraConfig,get_peft_model_state_dict

ROOT=Path(__file__).resolve().parents[2]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--mode',choices=['smoke','gpu'],default='smoke');ap.add_argument('--style',choices=['SI1.0','SI2.0'],required=True);ap.add_argument('--steps',type=int);ap.add_argument('--base-model')
    ap.add_argument('--output-dir',type=Path);ap.add_argument('--data-dir',type=Path)
    ap.add_argument('--precision',choices=['fp32','bf16'],default='fp32')
    ap.add_argument('--revision');ap.add_argument('--variant',choices=['fp16'])
    args=ap.parse_args()
    if args.mode=='gpu' and not torch.cuda.is_available():raise RuntimeError('GPU mode requires CUDA; use --mode smoke for local validation')
    device='cuda' if args.mode=='gpu' else 'cpu';steps=args.steps or (800 if args.mode=='gpu' else 80);size=512 if args.mode=='gpu' else 64
    if steps<1:raise ValueError('steps must be positive')
    base=args.base_model or ('stable-diffusion-v1-5/stable-diffusion-v1-5' if args.mode=='gpu' else 'hf-internal-testing/tiny-stable-diffusion-pipe')
    if args.precision=='bf16' and (device!='cuda' or not torch.cuda.is_bf16_supported()):raise RuntimeError('BF16 requires a supported CUDA GPU')
    dtype=torch.bfloat16 if args.precision=='bf16' else torch.float32
    def amp():return torch.autocast('cuda',dtype=dtype) if dtype!=torch.float32 else nullcontext()
    out=args.output_dir or ROOT/'资源库/99_历史归档/训练实验/style-v0/runs'/f'{args.mode}-{args.style}'
    if out.exists() and any(out.iterdir()):raise FileExistsError(f'Use a fresh --output-dir; existing experiment preserved: {out}')
    out.mkdir(parents=True,exist_ok=True)
    data=args.data_dir or ROOT/'资源库/99_历史归档/训练实验/style-v0';raw=(data/'metadata.jsonl').read_bytes();allrows=[json.loads(line) for line in raw.decode('utf8').splitlines()];rows=[r for r in allrows if r['style']==args.style];train=[r for r in rows if r['split']=='train'];val=[r for r in rows if r['split']=='validation']
    for row in rows:
        if hashlib.sha256((data/row['file_name']).read_bytes()).hexdigest()!=row['image_sha256']:raise ValueError('Image hash mismatch: '+row['file_name'])
    assert train and val and not {r['store_id'] for r in train}&{r['store_id'] for r in val}
    random.seed(73);np.random.seed(73);torch.manual_seed(73);torch.set_num_threads(min(4,os.cpu_count() or 1))
    started=time.time();(out/'status.json').write_text(json.dumps({'state':'running','mode':args.mode,'base':base}),encoding='utf8')
    revision=args.revision or ('3ee6c9f225f088ad5d35b624b6514b091e6a4849' if base=='hf-internal-testing/tiny-stable-diffusion-pipe' else None)
    load_options={'variant':args.variant,'use_safetensors':True} if args.variant else {}
    pipe=StableDiffusionPipeline.from_pretrained(base,revision=revision,safety_checker=None,torch_dtype=dtype,**load_options).to(device);pipe.set_progress_bar_config(disable=True)
    pipe.vae.requires_grad_(False);pipe.text_encoder.requires_grad_(False);pipe.unet.requires_grad_(False)
    pipe.vae.eval();pipe.text_encoder.eval()
    if args.mode=='gpu':pipe.unet.enable_gradient_checkpointing()
    scheduler=DDPMScheduler.from_config(pipe.scheduler.config)
    prompt=train[0]['text']
    def preview(name):
        with amp():im=pipe(prompt,height=size,width=size,num_inference_steps=20,guidance_scale=5,generator=torch.Generator(device=device).manual_seed(123)).images[0]
        im.save(out/name);return np.asarray(im)
    before=preview('before.png')
    pipe.unet.add_adapter(LoraConfig(r=4,lora_alpha=4,init_lora_weights='gaussian',target_modules=['to_q','to_k','to_v','to_out.0']))
    for p in pipe.unet.parameters():
        if p.requires_grad:p.data=p.data.float()
    params=[p for p in pipe.unet.parameters() if p.requires_grad];initial={k:v.detach().cpu().clone() for k,v in get_peft_model_state_dict(pipe.unet).items()}
    assert params and all('lora_' in n for n,p in pipe.unet.named_parameters() if p.requires_grad)
    optimizer=torch.optim.AdamW(params,lr=1e-4 if args.mode=='gpu' else 1e-3)
    cache=[]
    for r in rows:
        with Image.open(data/r['file_name']) as im:
            im=ImageOps.fit(im.convert('RGB'),(size,size),method=Image.Resampling.LANCZOS)
            tensor=torch.from_numpy(np.asarray(im).copy()).permute(2,0,1).unsqueeze(0).float().to(device)/127.5-1
        with torch.no_grad(),amp():
            # Deterministic mean latents: a deliberate small pilot simplification.
            latent=pipe.vae.encode(tensor.to(dtype)).latent_dist.mode()*pipe.vae.config.scaling_factor
            tokens=pipe.tokenizer(r['text'],padding='max_length',max_length=pipe.tokenizer.model_max_length,truncation=True,return_tensors='pt').input_ids.to(device)
            emb=pipe.text_encoder(tokens)[0]
        cache.append((r,latent,emb))
    tr=[x for x in cache if x[0]['split']=='train'];va=[x for x in cache if x[0]['split']=='validation']
    def objective(latent,emb,generator=None):
        noise=torch.randn(latent.shape,device=device,dtype=latent.dtype,generator=generator);t=torch.randint(0,scheduler.config.num_train_timesteps,(1,),device=device,generator=generator);noisy=scheduler.add_noise(latent,noise,t)
        target=scheduler.get_velocity(latent,noise,t) if scheduler.config.prediction_type=='v_prediction' else noise
        with amp():pred=pipe.unet(noisy,t,encoder_hidden_states=emb).sample
        return torch.nn.functional.mse_loss(pred.float(),target.float())
    def evaluate():
        pipe.unet.eval();g=torch.Generator(device=device).manual_seed(2026)
        with torch.no_grad():return sum(objective(l,e,g).item() for _,l,e in va)/len(va)
    initial_val=evaluate();logs=[]
    with (out/'loss.jsonl').open('w',encoding='utf8') as log:
        for step in range(steps):
            pipe.unet.train();_,latent,emb=tr[step%len(tr)];optimizer.zero_grad(set_to_none=True);loss=objective(latent,emb)
            if not torch.isfinite(loss):raise RuntimeError('Nonfinite loss')
            loss.backward();torch.nn.utils.clip_grad_norm_(params,1);optimizer.step();entry={'step':step+1,'loss':loss.item()};logs.append(entry);log.write(json.dumps(entry)+'\n');log.flush()
            if (step+1)%10==0:print(f'{args.style} {step+1}/{steps} loss={loss.item():.5f}',flush=True)
    final_val=evaluate();state=get_peft_model_state_dict(pipe.unet);delta=sum((v.detach().cpu()-initial[k]).abs().sum().item() for k,v in state.items());assert delta>0
    pipe.save_lora_weights(str(out),unet_lora_layers=convert_state_dict_to_diffusers(state),safe_serialization=True)
    after=preview('after.png');pipe.unload_lora_weights();pipe.load_lora_weights(str(out),weight_name='pytorch_lora_weights.safetensors');reloaded=preview('reloaded.png');reload_diff=int(np.abs(after.astype(int)-reloaded.astype(int)).max());assert reload_diff<=1
    summary={'state':'completed','mode':args.mode,'style':args.style,'base_model':base,'base_revision':revision,'device':device,'seed':73,'steps':steps,'resolution':size,'trainable_parameters':sum(p.numel() for p in params),'train_stores':sorted({r['store_id'] for r in train}),'validation_stores':sorted({r['store_id'] for r in val}),'train_images':len(train),'validation_images':len(val),'dataset_sha256':hashlib.sha256(raw).hexdigest(),'initial_validation_noise_mse':initial_val,'final_validation_noise_mse':final_val,'adapter_absolute_delta':delta,'reload_max_pixel_difference':reload_diff,'before_after_mean_pixel_difference':float(np.abs(before.astype(float)-after.astype(float)).mean()),'elapsed_seconds':time.time()-started,'usable_for_production':False,'interpretation':'tiny model tests gradient/save/reload only; output is not a useful store render' if args.mode=='smoke' else 'pilot training; requires visual review and more independent validation stores','crop_policy':'center crop to square; source rectangles and crop manifests retained','versions':{'torch':torch.__version__}}
    summary.update(precision=args.precision,checkpoint_variant=args.variant,peak_gpu_allocated_bytes=torch.cuda.max_memory_allocated() if device=='cuda' else None,
                   gpu_name=torch.cuda.get_device_name() if device=='cuda' else None,
                   label_warning='Master SI labels are not independently verified against historical PDF versions')
    (out/'report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8');(out/'status.json').write_text(json.dumps({'state':'completed','report':'report.json'}),encoding='utf8');print(json.dumps(summary,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
