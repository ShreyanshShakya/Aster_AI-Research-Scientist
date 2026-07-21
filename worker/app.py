"""Asynchronous, bounded CIFAR-10 executor for Distributed AI Research Scientist."""

import os
import random
from threading import Lock, Thread
from uuid import uuid4
from typing import Literal

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from torch import nn
from torch.utils.data import DataLoader, Subset
from torchvision import datasets, transforms

app = FastAPI(title="Distributed AI Research Scientist CIFAR-10 worker")
MAX_EPOCHS = min(int(os.getenv("MAX_EPOCHS", "5")), 5)
MAX_TRAIN_SAMPLES = min(int(os.getenv("MAX_TRAIN_SAMPLES", "5000")), 10_000)
MAX_VALIDATION_SAMPLES = min(int(os.getenv("MAX_VALIDATION_SAMPLES", "1000")), 2_000)
DATA_DIR = os.getenv("DATA_DIR", "./data")
jobs: dict[str, dict] = {}
jobs_lock = Lock()


class Experiment(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: Literal["baseline", "augmentation", "tuned-learning-rate"]
    requires: Literal["cpu", "gpu"]
    learningRate: float = Field(gt=0, le=0.01)
    augmentation: Literal["none", "standard"]
    epochs: int = Field(ge=1, le=5)
    metric: Literal["validation_accuracy"]
    profile: Literal["vision"]
    benchmark: dict


class ExecuteRequest(BaseModel):
    experiment: Experiment


class TinyCnn(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv2d(3, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Flatten(), nn.Linear(64 * 8 * 8, 128), nn.ReLU(), nn.Linear(128, 10),
        )

    def forward(self, value):
        return self.layers(value)


def update_job(job_id: str, **changes):
    with jobs_lock:
        jobs[job_id].update(changes)


def select_device(requirement: str) -> torch.device:
    if requirement == "gpu" and not torch.cuda.is_available():
        raise RuntimeError("This worker has no CUDA GPU for a GPU-required experiment.")
    return torch.device("cuda" if requirement == "gpu" else "cpu")


def run_job(job_id: str, experiment: Experiment):
    try:
        update_job(job_id, status="running", progress=5)
        random.seed(42); torch.manual_seed(42)
        device = select_device(experiment.requires)
        augmentation = [transforms.RandomCrop(32, padding=4), transforms.RandomHorizontalFlip()] if experiment.augmentation == "standard" else []
        normalize = transforms.Normalize((0.4914, 0.4822, 0.4465), (0.247, 0.243, 0.261))
        train_transform = transforms.Compose([*augmentation, transforms.ToTensor(), normalize])
        test_transform = transforms.Compose([transforms.ToTensor(), normalize])
        update_job(job_id, progress=10)
        train_set = datasets.CIFAR10(DATA_DIR, train=True, download=True, transform=train_transform)
        test_set = datasets.CIFAR10(DATA_DIR, train=False, download=True, transform=test_transform)
        train_loader = DataLoader(Subset(train_set, range(MAX_TRAIN_SAMPLES)), batch_size=64, shuffle=True, num_workers=2)
        test_loader = DataLoader(Subset(test_set, range(MAX_VALIDATION_SAMPLES)), batch_size=128, shuffle=False, num_workers=2)
        model = TinyCnn().to(device)
        optimizer = torch.optim.Adam(model.parameters(), lr=experiment.learningRate)
        loss_fn = nn.CrossEntropyLoss()
        for epoch in range(experiment.epochs):
            model.train()
            total_batches = len(train_loader)
            for batch_index, (images, labels) in enumerate(train_loader, start=1):
                images, labels = images.to(device), labels.to(device)
                optimizer.zero_grad(); loss_fn(model(images), labels).backward(); optimizer.step()
                if batch_index == total_batches or batch_index % 5 == 0:
                    fraction = (epoch + batch_index / total_batches) / experiment.epochs
                    update_job(job_id, progress=10 + int(70 * fraction))
        update_job(job_id, progress=85)
        model.eval(); correct = total = 0
        with torch.no_grad():
            for images, labels in test_loader:
                predictions = model(images.to(device)).argmax(dim=1).cpu()
                correct += int((predictions == labels).sum()); total += len(labels)
        update_job(job_id, status="completed", progress=100, metrics={"validation_accuracy": correct / total, "epochs": experiment.epochs, "simulated": False, "seed": 42, "train_samples": MAX_TRAIN_SAMPLES, "validation_samples": MAX_VALIDATION_SAMPLES})
    except Exception as error:
        update_job(job_id, status="failed", error=str(error))


@app.get("/health")
def health():
    return {"status": "ok", "benchmark": "cifar10-small-v1", "cuda": torch.cuda.is_available()}


@app.post("/execute", status_code=202)
def execute(request: ExecuteRequest):
    if request.experiment.benchmark.get("id") != "cifar10-small-v1":
        raise HTTPException(status_code=400, detail="This worker only runs the cifar10-small-v1 benchmark.")
    job_id = str(uuid4())
    with jobs_lock:
        jobs[job_id] = {"jobId": job_id, "experimentId": request.experiment.id, "status": "queued", "progress": 0}
    Thread(target=run_job, args=(job_id, request.experiment), daemon=True).start()
    return {"jobId": job_id, "status": "queued", "statusUrl": f"/jobs/{job_id}"}


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Unknown job ID")
        return job.copy()
