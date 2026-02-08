#!/bin/bash

# Set proxy settings for HTTP and HTTPS traffic
export http_proxy=http://10.63.2.48:3128/
export https_proxy=http://10.63.2.48:3128/

export TORCH_NCCL_ASYNC_ERROR_HANDLING=1
export USE_FLASH_ATTENTION=1
export HF_HOME="./hf_cache"
export HF_HUB_ENABLE_HF_TRANSFER=0

# Use the local lm-evaluation-harness fork instead of the container's installed version
export PYTHONPATH=/cluster/projects/nn10029k/davisamu/evals/lm-evaluation-harness:$PYTHONPATH

SIF=/cluster/projects/nn10029k/davisamu/evals/vllm_26.01_py3_arm_nlpl.sif

srun \
    --account=nn10029k \
    --partition=accel \
    --ntasks-per-node=1 \
    --cpus-per-task=4 \
    --mem=32G \
    --gpus-per-node=1 \
    --time=3:00:00 \
    --pty \
    apptainer exec --nv -B /cluster/projects/:/cluster/projects/,/cluster/work/projects/:/cluster/work/projects/ --env PYTHONPATH=${PYTHONPATH} $SIF bash
