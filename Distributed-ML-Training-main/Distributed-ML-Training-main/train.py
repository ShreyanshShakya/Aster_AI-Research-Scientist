import os
import argparse
import random
import json
from pathlib import Path
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torchvision import datasets, transforms, __version__ as torchvision_version
from torch.utils.data import DataLoader
from torch.utils.data.distributed import DistributedSampler

from dmlf.distributed.init import setup_distributed, cleanup_distributed
from dmlf.data.distributed_loader import create_distributed_dataloader
from dmlf.training.ddp_model import prepare_ddp_model
from dmlf.training.trainer import DDPTrainer

# Define a simple CNN for MNIST to satisfy the MVP model size constraint
class SimpleCNN(nn.Module):
    def __init__(self):
        super(SimpleCNN, self).__init__()
        self.conv1 = nn.Conv2d(1, 32, 3, 1)
        self.conv2 = nn.Conv2d(32, 64, 3, 1)
        self.dropout1 = nn.Dropout(0.25)
        self.dropout2 = nn.Dropout(0.5)
        self.fc1 = nn.Linear(9216, 128)
        self.fc2 = nn.Linear(128, 10)

    def forward(self, x):
        x = self.conv1(x)
        x = torch.relu(x)
        x = self.conv2(x)
        x = torch.relu(x)
        x = torch.max_pool2d(x, 2)
        x = self.dropout1(x)
        x = torch.flatten(x, 1)
        x = self.fc1(x)
        x = torch.relu(x)
        x = self.dropout2(x)
        x = self.fc2(x)
        return torch.log_softmax(x, dim=1)

def set_seed(seed=42):
    """Ensure reproducible experiments."""
    torch.manual_seed(seed)
    np.random.seed(seed)
    random.seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)

def main():
    parser = argparse.ArgumentParser(description='DMLF MVP Training Script')
    parser.add_argument('--epochs', type=int, default=10, help='number of epochs to train')
    parser.add_argument('--batch-size', type=int, default=64, help='input batch size for training (per worker)')
    parser.add_argument('--lr', type=float, default=0.01, help='learning rate')
    parser.add_argument('--backend', type=str, default='nccl', choices=['nccl', 'gloo'], help='distributed backend')
    parser.add_argument('--augmentation', type=str, default='none', choices=['none', 'standard'], help='controlled MNIST augmentation')
    parser.add_argument('--dataset', type=str, default='mnist', choices=['mnist', 'synthetic'], help='MNIST benchmark or explicit offline synthetic smoke-test data')
    parser.add_argument('--seed', type=int, default=42, help='reproducibility seed for this experiment repeat')
    parser.add_argument('--rendezvous-timeout-seconds', type=int, default=90, help='maximum seconds to wait for DDP nodes to connect')
    parser.add_argument('--resume', type=str, default='', help='path to checkpoint to resume from')
    args = parser.parse_args()

    # Phase 8.1: Environment Synchronization
    set_seed(args.seed)

    # Setup distributed environment
    dist_info = setup_distributed(backend=args.backend, timeout_seconds=max(15, min(args.rendezvous_timeout_seconds, 300)))
    rank = dist_info['rank']
    local_rank = dist_info['local_rank']

    # Phase 7.2: Dataset Distribution (Identical local copies)
    train_steps = []
    if args.augmentation == 'standard':
        train_steps.append(transforms.RandomAffine(degrees=10, translate=(0.08, 0.08)))
    train_steps.extend([transforms.ToTensor(), transforms.Normalize((0.1307,), (0.3081,))])
    transform = transforms.Compose(train_steps)
    test_transform = transforms.Compose([transforms.ToTensor(), transforms.Normalize((0.1307,), (0.3081,))])
    
    data_root = Path(os.environ.get('DMLF_DATA_DIR', Path(__file__).resolve().parent / 'data')).resolve()
    if args.dataset == 'mnist':
        # Native LAN agents have separate disks, so each node verifies its
        # local copy. Docker Compose workers share /app/data, where only rank
        # zero may download before every rank opens the verified files.
        shared_data = os.environ.get('DMLF_SHARED_DATA', '').strip().lower() in {'1', 'true', 'yes'}
        if shared_data:
            if rank == 0:
                datasets.MNIST(str(data_root), train=True, download=True)
                datasets.MNIST(str(data_root), train=False, download=True)
            torch.distributed.barrier()
            dataset = datasets.MNIST(str(data_root), train=True, download=False, transform=transform)
            test_dataset = datasets.MNIST(str(data_root), train=False, download=False, transform=test_transform)
        else:
            dataset = datasets.MNIST(str(data_root), train=True, download=True, transform=transform)
            test_dataset = datasets.MNIST(str(data_root), train=False, download=True, transform=test_transform)
            torch.distributed.barrier()
    else:
        # Explicit offline smoke-test dataset. It exercises real forward,
        # backward, DDP synchronization, and validation without claiming to
        # measure MNIST performance.
        dataset = datasets.FakeData(size=1024, image_size=(1, 28, 28), num_classes=10, transform=transform, random_offset=args.seed)
        test_dataset = datasets.FakeData(size=256, image_size=(1, 28, 28), num_classes=10, transform=test_transform, random_offset=10_000 + args.seed)

    # Create distributed dataloader
    train_loader, sampler = create_distributed_dataloader(
        dataset=dataset,
        batch_size=args.batch_size,
        is_training=True,
        num_workers=0
    )

    # Phase 7.4: Model Synchronization
    model = SimpleCNN()
    ddp_model = prepare_ddp_model(model)

    optimizer = optim.SGD(ddp_model.parameters(), lr=args.lr, momentum=0.9)
    criterion = nn.NLLLoss()

    # Initialize Trainer
    trainer = DDPTrainer(
        model=ddp_model,
        optimizer=optimizer,
        train_loader=train_loader,
        criterion=criterion,
        epochs=args.epochs,
        checkpoint_dir='dmlf/checkpoint',
        rank=rank,
        local_rank=local_rank,
        checkpoint_interval_minutes=5
    )

    if args.resume:
        trainer.load_checkpoint(args.resume)

    # Start training
    if rank == 0:
        print("Starting training...")
    trainer.train()

    # Verify that every DDP rank holds identical post-training parameters.
    with torch.no_grad():
        checksum = torch.stack([parameter.detach().float().sum() for parameter in ddp_model.parameters()]).sum().to(ddp_model.parameters().__next__().device)
    rank_checksums = [torch.zeros_like(checksum) for _ in range(dist_info['world_size'])]
    torch.distributed.all_gather(rank_checksums, checksum)
    checksum_values = [value.item() for value in rank_checksums]
    ddp_synchronized = max(checksum_values) - min(checksum_values) < 1e-5

    # Aggregate a real validation metric across every DDP rank. The bridge
    # consumes this structured rank-zero log from the DMLF log stream.
    test_sampler = DistributedSampler(test_dataset, shuffle=False)
    test_loader = DataLoader(test_dataset, batch_size=args.batch_size, sampler=test_sampler, num_workers=0)
    ddp_model.eval()
    device = torch.device(f'cuda:{local_rank}' if torch.cuda.is_available() else 'cpu')
    correct = torch.tensor(0, device=device, dtype=torch.long)
    total = torch.tensor(0, device=device, dtype=torch.long)
    with torch.no_grad():
        for inputs, targets in test_loader:
            predictions = ddp_model(inputs.to(device)).argmax(dim=1)
            correct += (predictions == targets.to(device)).sum()
            total += targets.numel()
    torch.distributed.all_reduce(correct, op=torch.distributed.ReduceOp.SUM)
    torch.distributed.all_reduce(total, op=torch.distributed.ReduceOp.SUM)
    if rank == 0:
        print('DMLF_RESULT_JSON ' + json.dumps({
            'validation_accuracy': (correct.float() / total.float()).item(),
            'epochs': args.epochs,
            'simulated': False,
            'execution_engine': 'dmlf-ddp',
            'world_size': dist_info['world_size'],
            'dataset': args.dataset,
            'seed': args.seed,
            'dataset_root': str(data_root),
            'torch_version': torch.__version__,
            'torchvision_version': torchvision_version,
            'ddp_synchronized': ddp_synchronized,
            'rank_weight_checksums': checksum_values,
        }))

    cleanup_distributed()
    if rank == 0:
        print("Training completed.")

if __name__ == '__main__':
    main()
